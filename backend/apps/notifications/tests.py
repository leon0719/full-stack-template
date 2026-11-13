import smtplib
from datetime import timedelta

import httpx
import orjson
import pytest
from django.core import mail
from django.test import Client
from django.utils import timezone

from apps.notifications.models import Notification
from apps.notifications.services import LineWebhookService, NotificationService
from apps.notifications.utils import email_subject, line_signature, verify_line_signature

SECRET = "line-channel-secret"


@pytest.fixture(autouse=True)
def _reset_throttle_counters():
    from django.core.cache import cache

    cache.clear()


@pytest.fixture
def enqueued(monkeypatch):
    """Capture send_notification.delay instead of hitting a broker."""
    calls: list[int] = []
    monkeypatch.setattr("apps.notifications.tasks.send_notification.delay", lambda nid: calls.append(nid))
    return calls


@pytest.fixture
def alerts(monkeypatch):
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr("apps.notifications.services.alert", lambda msg, **ctx: calls.append((msg, ctx)))
    return calls


@pytest.fixture
def line_posts(monkeypatch, settings):
    """Configure LINE and capture httpx.post; set ``line_posts.status`` to control the reply."""
    settings.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = "token"

    class Recorder(list):
        status = 200

    calls = Recorder()

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return httpx.Response(calls.status, text="err body", request=httpx.Request("POST", url))

    monkeypatch.setattr("apps.notifications.external_services.httpx.post", fake_post)
    return calls


# ==================== utils ====================


@pytest.mark.unit
def test_line_signature_roundtrip_and_rejections():
    body = b'{"events":[]}'
    sig = line_signature(body, SECRET)
    assert verify_line_signature(body, sig, SECRET)
    assert not verify_line_signature(body + b" ", sig, SECRET)  # raw bytes matter
    assert not verify_line_signature(body, sig, "other-secret")
    assert not verify_line_signature(body, "", SECRET)
    assert not verify_line_signature(body, sig, "")
    assert not verify_line_signature(body, "非ASCII", SECRET)


@pytest.mark.unit
def test_email_subject_prefix_only_outside_prod():
    assert email_subject("Hi", "local") == "[DEV] Hi"
    assert email_subject("[DEV] Hi", "staging") == "[DEV] Hi"
    assert email_subject("Hi", "prod") == "Hi"


@pytest.mark.unit
def test_log_only_backend_does_not_send(settings):
    from django.core.mail import EmailMessage

    from apps.notifications.mail_backends import LogOnlyEmailBackend

    backend = LogOnlyEmailBackend(alias="default")
    assert backend.send_messages([EmailMessage("s", "b", "a@example.com", ["x@example.com"])]) == 1


# ==================== enqueue / deliver ====================


@pytest.mark.integration
def test_enqueue_email_writes_outbox_then_enqueues_on_commit(user, enqueued, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        n = NotificationService.enqueue_email("to@example.com", "Hello", "Body", user=user, source="test:1")

    assert enqueued == [n.pk]
    n.refresh_from_db()
    assert (n.channel, n.user_id, n.sent_at, n.retry_count) == ("email", user.id, None, 0)


@pytest.mark.integration
def test_enqueue_inside_rolled_back_transaction_leaves_nothing(db, enqueued, django_capture_on_commit_callbacks):
    from django.db import transaction

    with django_capture_on_commit_callbacks(execute=True), pytest.raises(RuntimeError), transaction.atomic():
        NotificationService.enqueue_email("to@example.com", "Hello", "Body")
        raise RuntimeError("business failure")

    assert not Notification.objects.exists()
    assert enqueued == []


@pytest.mark.unit
@pytest.mark.parametrize("texts", [[], ["a"] * 6, [""], ["x" * 5001]])
def test_enqueue_line_validates_messages(texts):
    with pytest.raises(ValueError):
        NotificationService.enqueue_line("U123", texts)


@pytest.mark.integration
def test_deliver_email_sends_with_dev_prefix_and_marks_sent(db):
    n = Notification.objects.create(
        channel="email", recipient="to@example.com", payload={"subject": "Hi", "body": "B", "html_body": "<p>B</p>"}
    )

    assert NotificationService.deliver(n.pk) == "sent"

    assert len(mail.outbox) == 1
    msg = mail.outbox[0]
    assert msg.subject == "[DEV] Hi"
    assert msg.to == ["to@example.com"]
    assert msg.alternatives[0][1] == "text/html"  # type: ignore[attr-defined]  # EmailMultiAlternatives
    assert msg.extra_headers["X-Notification-Id"] == str(n.idempotency_key)
    n.refresh_from_db()
    assert n.sent_at is not None and n.locked_until is None
    # Idempotent: a duplicate delivery (beat retry / broker redelivery) is skipped.
    assert NotificationService.deliver(n.pk) == "skipped"
    assert len(mail.outbox) == 1


@pytest.mark.integration
def test_deliver_failure_counts_retries_then_abandons_and_alerts(db, monkeypatch, settings, alerts):
    settings.NOTIFICATION_MAX_RETRIES = 2

    def boom(self, *args, **kwargs):
        raise smtplib.SMTPServerDisconnected("gone")

    monkeypatch.setattr("django.core.mail.EmailMultiAlternatives.send", boom)
    n = Notification.objects.create(channel="email", recipient="to@example.com", payload={"subject": "s", "body": "b"})

    assert NotificationService.deliver(n.pk) == "failed"
    n.refresh_from_db()
    assert (n.retry_count, n.abandoned_at, n.locked_until) == (1, None, None)
    assert "SMTPServerDisconnected" in n.last_error
    assert alerts == []

    assert NotificationService.deliver(n.pk) == "abandoned"
    n.refresh_from_db()
    assert n.retry_count == 2 and n.abandoned_at is not None
    assert alerts[0][1]["notification_id"] == n.pk
    assert NotificationService.deliver(n.pk) == "skipped"  # abandoned rows are never retried automatically


@pytest.mark.integration
def test_claimed_notification_is_not_delivered_twice(db):
    n = Notification.objects.create(channel="email", recipient="a@example.com", payload={"subject": "s", "body": "b"})
    assert NotificationService.claim(n.pk) is not None
    assert NotificationService.claim(n.pk) is None  # in flight elsewhere

    Notification.objects.filter(pk=n.pk).update(locked_until=timezone.now() - timedelta(seconds=1))
    assert NotificationService.claim(n.pk) is not None  # expired claim (dead worker) is released


@pytest.mark.integration
def test_line_not_configured_logs_and_marks_sent(db, settings):
    settings.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = ""
    n = NotificationService.enqueue_line("U123", "hi")
    assert NotificationService.deliver(n.pk) == "sent"


@pytest.mark.integration
def test_line_push_sends_retry_key_and_treats_409_as_sent(db, line_posts):
    n = NotificationService.enqueue_line("U123", ["one", "two"])

    line_posts.status = 409  # retry key already accepted by LINE → earlier attempt went through
    assert NotificationService.deliver(n.pk) == "sent"

    call = line_posts[0]
    assert call["json"] == {
        "to": "U123",
        "messages": [{"type": "text", "text": "one"}, {"type": "text", "text": "two"}],
    }
    assert call["headers"]["X-Line-Retry-Key"] == str(n.idempotency_key)
    assert call["headers"]["Authorization"] == "Bearer token"
    assert call["timeout"] == 10.0


@pytest.mark.integration
def test_line_push_http_error_is_recorded(db, line_posts):
    line_posts.status = 429
    n = NotificationService.enqueue_line("U123", "hi")
    assert NotificationService.deliver(n.pk) == "failed"
    n.refresh_from_db()
    assert n.last_error.startswith("HTTP 429")


@pytest.mark.integration
def test_line_push_transport_error_degrades_to_failure(db, monkeypatch, settings):
    import time

    settings.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = "token"
    monkeypatch.setattr(time, "sleep", lambda _s: None)

    def refuse(url, **kwargs):
        raise httpx.ConnectError("refused", request=httpx.Request("POST", url))

    monkeypatch.setattr("apps.notifications.external_services.httpx.post", refuse)
    n = NotificationService.enqueue_line("U123", "hi")
    assert NotificationService.deliver(n.pk) == "failed"
    n.refresh_from_db()
    assert "unreachable" in n.last_error


# ==================== beat tasks ====================


@pytest.mark.integration
def test_retry_pending_picks_only_old_unlocked_pending_rows(db, enqueued):
    from apps.notifications.tasks import retry_pending_notifications

    old = timezone.now() - timedelta(minutes=5)
    due = Notification.objects.create(channel="email", recipient="a@example.com", payload={})
    fresh = Notification.objects.create(channel="email", recipient="b@example.com", payload={})
    sent = Notification.objects.create(channel="email", recipient="c@example.com", payload={}, sent_at=old)
    locked = Notification.objects.create(
        channel="email", recipient="d@example.com", payload={}, locked_until=timezone.now() + timedelta(minutes=1)
    )
    Notification.objects.filter(pk__in=[due.pk, sent.pk, locked.pk]).update(created_at=old)

    assert retry_pending_notifications() == 1
    assert enqueued == [due.pk]
    assert fresh.pk not in enqueued


@pytest.mark.integration
def test_purge_old_notifications_keeps_pending(db, settings):
    from apps.notifications.tasks import purge_old_notifications

    settings.NOTIFICATION_RETENTION_DAYS = 30
    ancient = timezone.now() - timedelta(days=31)
    Notification.objects.create(channel="email", recipient="a@example.com", payload={}, sent_at=ancient)
    Notification.objects.create(channel="email", recipient="b@example.com", payload={}, abandoned_at=ancient)
    pending = Notification.objects.create(channel="email", recipient="c@example.com", payload={})
    Notification.objects.filter(pk=pending.pk).update(created_at=ancient)

    assert purge_old_notifications() == 2
    assert list(Notification.objects.values_list("pk", flat=True)) == [pending.pk]

    settings.NOTIFICATION_RETENTION_DAYS = 0
    assert purge_old_notifications() == 0


# ==================== endpoints ====================


def _webhook(body: bytes, signature: str | None):
    headers = {"X-Line-Signature": signature} if signature is not None else {}
    return Client().post("/notifications/line/webhook", data=body, content_type="application/json", headers=headers)


@pytest.mark.integration
def test_line_webhook_accepts_valid_signature(db, settings):
    settings.LINE_MESSAGING_CHANNEL_SECRET = SECRET
    body = orjson.dumps({"destination": "U0", "events": [{"type": "follow"}, {"type": "message"}]})

    resp = _webhook(body, line_signature(body, SECRET))

    assert resp.status_code == 200
    assert resp.json() == {"data": None, "error": None}


@pytest.mark.integration
@pytest.mark.parametrize("signature", [None, "", "bm9wZQ=="])
def test_line_webhook_rejects_bad_signature(db, settings, signature):
    settings.LINE_MESSAGING_CHANNEL_SECRET = SECRET
    resp = _webhook(b'{"events":[]}', signature)
    assert resp.status_code == 401
    assert resp.json()["error"]["reason"] == "invalid_signature"


@pytest.mark.integration
def test_line_webhook_unconfigured_returns_503(db, settings):
    settings.LINE_MESSAGING_CHANNEL_SECRET = ""
    assert _webhook(b'{"events":[]}', "x").status_code == 503


@pytest.mark.unit
def test_line_webhook_rejects_malformed_json_even_when_signed(settings):
    from config.errors import AppError

    settings.LINE_MESSAGING_CHANNEL_SECRET = SECRET
    body = b"not json"
    with pytest.raises(AppError) as exc:
        LineWebhookService.handle(body, line_signature(body, SECRET))
    assert exc.value.status_code == 400


@pytest.mark.integration
def test_failed_list_is_admin_only_and_lists_undelivered(db, admin_auth_headers, auth_headers):
    Notification.objects.create(channel="email", recipient="a@example.com", payload={}, sent_at=timezone.now())
    stuck = Notification.objects.create(
        channel="line", recipient="U1", payload={}, retry_count=5, abandoned_at=timezone.now(), last_error="HTTP 400"
    )

    assert Client().get("/notifications/failed", headers=auth_headers).status_code == 403
    resp = Client().get("/notifications/failed", headers=admin_auth_headers)

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["count"] == 1
    assert data["items"][0]["id"] == stuck.pk
    assert data["items"][0]["abandoned_at"] is not None
    assert "payload" not in data["items"][0]


@pytest.mark.integration
def test_admin_retry_action_resets_abandoned(admin_user, enqueued, django_capture_on_commit_callbacks):
    client = Client()
    client.force_login(admin_user)
    n = Notification.objects.create(
        channel="email", recipient="a@example.com", payload={}, retry_count=5, abandoned_at=timezone.now()
    )

    with django_capture_on_commit_callbacks(execute=True):
        resp = client.post("/admin/notifications/notification/", {"action": "retry_now", "_selected_action": [n.pk]})

    assert resp.status_code == 302
    n.refresh_from_db()
    assert (n.retry_count, n.abandoned_at) == (0, None)
    assert enqueued == [n.pk]


# ==================== push to a User (LineProfile → LINE userId) ====================


@pytest.mark.integration
def test_enqueue_line_to_user_uses_line_profile_user_id(user, enqueued, django_capture_on_commit_callbacks):
    from apps.accounts.models import LineProfile

    LineProfile.objects.create(user=user, line_user_id="U1234567890abcdef")
    with django_capture_on_commit_callbacks(execute=True):
        notification = NotificationService.enqueue_line_to_user(user, "hi", source="test")

    assert notification is not None
    assert (notification.channel, notification.recipient, notification.user_id) == (
        "line",
        "U1234567890abcdef",
        user.pk,
    )
    assert enqueued == [notification.pk]


@pytest.mark.integration
def test_enqueue_line_to_user_without_line_profile_is_skipped(user, enqueued):
    assert NotificationService.enqueue_line_to_user(user, "hi") is None
    assert not Notification.objects.exists()
