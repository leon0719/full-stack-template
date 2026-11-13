import pytest

from apps.audit.models import AuditLog


@pytest.fixture(autouse=True)
def _reset_throttle_counters():
    from django.core.cache import cache

    cache.clear()


@pytest.mark.integration
def test_record_snapshots_actor_username(user):
    entry = AuditLog.record(AuditLog.Action.LINE_LOGIN_SUCCESS, user=user, foo="bar")
    assert entry.actor_id == user.id
    assert entry.actor_username == user.username
    assert entry.metadata == {"foo": "bar"}


@pytest.mark.integration
def test_record_without_user_leaves_actor_blank(db):
    entry = AuditLog.record(AuditLog.Action.LINE_LOGIN_FAILED)
    assert entry.actor_id is None
    assert entry.actor_username == ""


@pytest.mark.integration
def test_actor_username_survives_user_deletion(user):
    entry = AuditLog.record(AuditLog.Action.LINE_LOGIN_SUCCESS, user=user)
    username = user.username

    user.delete()

    entry.refresh_from_db()
    assert entry.actor_id is None  # SET_NULL, not CASCADE — the row survives
    assert entry.actor_username == username  # snapshot preserved


@pytest.mark.integration
def test_logout_is_recorded_with_tokens_revoked_count(user):
    from apps.accounts.services import AuthService

    AuthService.issue_token(user)
    AuthService.issue_token(user)

    AuthService.logout(user)

    entry = AuditLog.objects.get(actor=user, action=AuditLog.Action.LOGOUT)
    assert entry.metadata == {"tokens_revoked": 2}


@pytest.mark.integration
def test_record_merges_request_context_during_api_call(user, auth_headers):
    from django.test import Client

    resp = Client().post("/auth/logout", headers={**auth_headers, "X-Request-ID": "req-audit-1"})

    assert resp.status_code == 200
    entry = AuditLog.objects.get(action=AuditLog.Action.LOGOUT)
    assert entry.metadata == {"tokens_revoked": 1, "request_id": "req-audit-1", "ip": "127.0.0.1"}


@pytest.mark.integration
def test_admin_login_success_is_recorded(db):
    from django.contrib.auth.models import User
    from django.test import Client

    admin_user = User.objects.create_superuser("root", "root@example.com", "pw-12345678")

    resp = Client().post("/admin/login/", {"username": "root", "password": "pw-12345678", "next": "/admin/"})

    assert resp.status_code == 302
    assert AuditLog.objects.filter(actor=admin_user, action=AuditLog.Action.ADMIN_LOGIN_SUCCESS).exists()


@pytest.mark.integration
def test_admin_login_failure_is_recorded_without_credentials(db):
    from django.test import Client

    resp = Client().post("/admin/login/", {"username": "root-typo", "password": "secret-guess-123"})

    assert resp.status_code == 200
    entry = AuditLog.objects.get(action=AuditLog.Action.ADMIN_LOGIN_FAILED)
    assert entry.actor_id is None
    assert entry.actor_username == ""
    assert set(entry.metadata) == {"request_id", "ip"}


@pytest.mark.integration
def test_line_login_is_not_recorded_as_admin_login(user, rf):
    """allauth's LINE login also fires user_logged_in; only /admin/ requests count as admin logins."""
    from django.contrib.auth.signals import user_logged_in

    user_logged_in.send(sender=type(user), request=rf.get("/accounts/line/login/callback/"), user=user)

    assert not AuditLog.objects.filter(action=AuditLog.Action.ADMIN_LOGIN_SUCCESS).exists()


@pytest.mark.integration
def test_purge_old_audit_logs_removes_only_old_rows(db, settings):
    from datetime import timedelta

    from django.utils import timezone

    from apps.audit.tasks import purge_old_audit_logs

    settings.AUDIT_LOG_RETENTION_DAYS = 30
    old = AuditLog.record(AuditLog.Action.LINE_LOGIN_FAILED)
    recent = AuditLog.record(AuditLog.Action.LINE_LOGIN_FAILED)
    AuditLog.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=31))

    deleted = purge_old_audit_logs()

    assert deleted == 1
    assert list(AuditLog.objects.values_list("pk", flat=True)) == [recent.pk]


@pytest.mark.integration
def test_purge_old_audit_logs_disabled_when_retention_is_zero(db, settings):
    from datetime import timedelta

    from django.utils import timezone

    from apps.audit.tasks import purge_old_audit_logs

    settings.AUDIT_LOG_RETENTION_DAYS = 0
    old = AuditLog.record(AuditLog.Action.LINE_LOGIN_FAILED)
    AuditLog.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=3650))

    assert purge_old_audit_logs() == 0
    assert AuditLog.objects.filter(pk=old.pk).exists()


# ==================== Business audit (services.record_audit) ====================


@pytest.mark.unit
def test_diff_masks_sensitive_fields_and_skips_unchanged():
    from apps.audit.services import MASK, diff

    changes = diff(
        {"title": "a", "status": "draft", "password": "old-hash", "api_key": None},
        {"title": "b", "status": "draft", "password": "new-hash", "api_key": "k"},
    )
    assert changes == {"title": ["a", "b"], "password": [MASK, MASK], "api_key": [None, MASK]}


@pytest.mark.integration
def test_snapshot_uses_attnames_and_skips_timestamps(user):
    from apps.articles.models import Article
    from apps.audit.services import snapshot

    article = Article.objects.create(owner=user, title="t")
    snap = snapshot(article)
    assert snap["owner_id"] == user.id
    assert "created_at" not in snap and "updated_at" not in snap and "id" not in snap


@pytest.mark.integration
def test_record_audit_stores_target_diff_and_request_context(user):
    from apps.articles.models import Article
    from apps.audit.services import record_audit, snapshot

    article = Article.objects.create(owner=user, title="before")
    before = snapshot(article)
    article.title = "after"
    article.save()

    entry = record_audit(AuditLog.Action.UPDATE, actor=user, target=article, before=before, reason="typo")

    assert entry.target_type == "articles.article"
    assert entry.target_id == str(article.pk)
    assert entry.changes == {"title": ["before", "after"]}
    assert entry.metadata == {"reason": "typo"}  # no request → no ip/request_id
    assert entry.actor_username == user.username


@pytest.mark.integration
def test_record_audit_rolls_back_with_the_business_write(user):
    from django.db import transaction

    from apps.articles.models import Article
    from apps.audit.services import record_audit

    with pytest.raises(RuntimeError), transaction.atomic():
        article = Article.objects.create(owner=user, title="x")
        record_audit(AuditLog.Action.CREATE, actor=user, target=article, after={"title": "x"})
        raise RuntimeError("business write failed")

    assert not AuditLog.objects.filter(action=AuditLog.Action.CREATE).exists()


@pytest.mark.integration
def test_record_audit_with_model_class_target_has_no_id_and_no_diff(user):
    from apps.articles.models import Article
    from apps.audit.services import record_audit

    entry = record_audit(AuditLog.Action.EXPORT, actor=user, target=Article, rows=3)
    assert (entry.target_type, entry.target_id, entry.changes) == ("articles.article", "", None)


# ==================== Django admin (AuditedAdminMixin) ====================


@pytest.fixture
def superuser_client(admin_user):
    from django.test import Client

    client = Client()
    client.force_login(admin_user)
    return client


@pytest.mark.integration
def test_admin_change_is_audited_with_diff(superuser_client, admin_user, user):
    from apps.articles.models import Article

    article = Article.objects.create(owner=user, title="old", content="body")
    resp = superuser_client.post(
        f"/admin/articles/article/{article.pk}/change/",
        {"owner": user.pk, "title": "new", "content": "body", "status": "draft"},
    )

    assert resp.status_code == 302, resp.content[:500]
    entry = AuditLog.objects.get(action=AuditLog.Action.ADMIN_CHANGE)
    assert entry.actor_id == admin_user.id
    assert (entry.target_type, entry.target_id) == ("articles.article", str(article.pk))
    assert entry.changes == {"title": ["old", "new"]}
    assert entry.metadata["ip"] == "127.0.0.1"


@pytest.mark.integration
def test_admin_save_without_changes_is_not_audited(superuser_client, user):
    from apps.articles.models import Article

    article = Article.objects.create(owner=user, title="same", content="")
    superuser_client.post(
        f"/admin/articles/article/{article.pk}/change/",
        {"owner": user.pk, "title": "same", "content": "", "status": "draft"},
    )
    assert not AuditLog.objects.filter(action=AuditLog.Action.ADMIN_CHANGE).exists()


@pytest.mark.integration
def test_admin_role_change_is_audited_and_password_masked(superuser_client, user):
    """Granting the admin role (group m2m) is a privilege change and must show up in the trail."""
    from django.contrib.auth.models import Group

    admin_group = Group.objects.get(name="admin")
    resp = superuser_client.post(
        f"/admin/auth/user/{user.pk}/change/",
        {
            "username": user.username,
            "email": user.email,
            "is_active": "on",
            "groups": [admin_group.pk],
            "date_joined_0": "2026-01-01",
            "date_joined_1": "00:00:00",
            "initial-date_joined_0": "2026-01-01",
            "initial-date_joined_1": "00:00:00",
        },
    )

    assert resp.status_code == 302, resp.content[:800]
    entry = AuditLog.objects.get(action=AuditLog.Action.ADMIN_CHANGE, target_type="auth.user")
    assert entry.changes is not None
    assert entry.changes["groups"] == [[], [admin_group.pk]]
    assert entry.changes is not None
    assert "password" not in entry.changes  # unchanged → not listed at all


@pytest.mark.integration
def test_admin_add_and_bulk_delete_are_audited(superuser_client, user):
    from apps.holidays.models import Holiday

    superuser_client.post("/admin/holidays/holiday/add/", {"day": "2026-10-10", "name": "國慶日", "is_holiday": "on"})
    holiday = Holiday.objects.get(day="2026-10-10")
    added = AuditLog.objects.get(action=AuditLog.Action.ADMIN_ADD)
    assert added.changes is not None
    assert added.changes["name"] == [None, "國慶日"]

    superuser_client.post(
        "/admin/holidays/holiday/",
        {"action": "delete_selected", "_selected_action": [holiday.pk], "post": "yes"},
    )
    assert not Holiday.objects.exists()
    deleted = AuditLog.objects.get(action=AuditLog.Action.ADMIN_DELETE)
    assert deleted.target_id == str(holiday.pk)
    assert deleted.changes is not None
    assert deleted.changes["name"] == ["國慶日", None]
