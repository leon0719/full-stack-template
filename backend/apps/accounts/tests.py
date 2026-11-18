import pytest
from django.test import Client


@pytest.fixture(autouse=True)
def _reset_throttle_counters():
    """Throttle counters live in the (LocMem) cache and persist across tests in
    the same process; clear them so register/login tests never trip 5/h limits."""
    from django.core.cache import cache

    cache.clear()


@pytest.mark.unit
def test_throttle_ident_not_spoofable_when_num_proxies_set(monkeypatch):
    """Regression for the NINJA_NUM_PROXIES bypass (config/settings/prod.py).

    Without NINJA_NUM_PROXIES, ninja keys per-IP throttles on the raw
    client-controlled X-Forwarded-For string, so varying the header yields a
    fresh throttle bucket per request. With NUM_PROXIES=1 the key is the last
    XFF entry — the one appended by the trusted proxy — so spoofed prefixes
    cannot change it.
    """
    from django.test import RequestFactory
    from ninja.conf import settings as ninja_settings

    from apps.core.throttling import LoginThrottle

    rf = RequestFactory()
    throttle = LoginThrottle()

    def idents():
        return {
            throttle.get_ident(rf.post("/auth/login", HTTP_X_FORWARDED_FOR=f"{spoofed}, 203.0.113.7"))
            for spoofed in ("10.1.1.1", "10.2.2.2", "10.3.3.3")
        }

    # Vulnerable default: each spoofed prefix gets its own throttle key.
    monkeypatch.setattr(ninja_settings, "NUM_PROXIES", None)
    assert len(idents()) == 3

    # prod configuration: the key is always the trusted proxy's entry.
    monkeypatch.setattr(ninja_settings, "NUM_PROXIES", 1)
    assert idents() == {"203.0.113.7"}


@pytest.mark.integration
def test_me_requires_auth(db):
    resp = Client().get("/auth/me")
    assert resp.status_code == 401


@pytest.mark.integration
def test_expired_token_rejected_and_deleted(user):
    from datetime import timedelta

    from django.utils import timezone

    from apps.accounts.models import AuthToken
    from apps.core.security import generate_token

    raw, digest = generate_token()
    AuthToken.objects.create(user=user, digest=digest, expiry=timezone.now() - timedelta(minutes=1))

    resp = Client().get("/auth/me", headers={"Authorization": f"Bearer {raw}"})

    assert resp.status_code == 401
    # Lazy cleanup: presenting an expired token removes it immediately.
    assert not AuthToken.objects.filter(digest=digest).exists()


@pytest.mark.integration
def test_inactive_user_token_rejected(user, auth_headers):
    user.is_active = False
    user.save()

    resp = Client().get("/auth/me", headers=auth_headers)
    assert resp.status_code == 401


@pytest.mark.integration
def test_purge_expired_tokens_removes_only_expired(user):
    from datetime import timedelta

    from django.utils import timezone

    from apps.accounts.models import AuthToken
    from apps.accounts.tasks import purge_expired_tokens

    AuthToken.objects.create(user=user, digest="expired", expiry=timezone.now() - timedelta(days=1))
    AuthToken.objects.create(user=user, digest="valid", expiry=timezone.now() + timedelta(days=1))

    deleted = purge_expired_tokens()

    assert deleted == 1
    assert list(AuthToken.objects.values_list("digest", flat=True)) == ["valid"]


@pytest.mark.integration
def test_line_login_redirects_using_settings_config(db, settings):
    """Test that the LINE OAuth login endpoint redirects to LINE's authorize URL using
    only SOCIALACCOUNT_PROVIDERS settings (no database SocialApp row).

    This regression test verifies that the adapter uses the base class list_apps()
    behavior, which merges settings-based APP with database-stored apps. Without
    the base behavior, this test fails with SocialApp.DoesNotExist (the critical bug).
    """
    from allauth.socialaccount.models import SocialApp

    # Ensure no leftover LINE SocialApps from previous tests — the whole point is
    # to verify settings-based config works WITHOUT a database row.
    SocialApp.objects.filter(provider="line").delete()

    # The frontend's LINE login link is a plain GET <a href> (not a form POST) —
    # exercise that exact path. This requires SOCIALACCOUNT_LOGIN_ON_GET = True
    # in settings; without it, allauth renders an interim confirmation page on
    # GET instead of redirecting (see config/settings/base.py).
    # The SOCIALACCOUNT_PROVIDERS["line"]["APP"] is already configured in settings
    # (loaded from LINE_LOGIN_CHANNEL_ID/SECRET env vars in conftest/test env setup).
    resp = Client().get("/accounts/line/login/?process=login")
    assert resp.status_code == 302
    assert "access.line.me" in resp["Location"]


@pytest.mark.unit
def test_line_profile_str_and_getattr_fallback(user):
    from apps.accounts.models import LineProfile

    assert getattr(user, "line_profile", None) is None

    profile = LineProfile.objects.create(
        user=user, line_user_id="U1234", display_name="Alice", picture_url="https://example.com/a.jpg"
    )
    user.refresh_from_db()
    assert user.line_profile == profile
    assert str(profile) == f"LineProfile(user_id={user.id})"


@pytest.mark.unit
def test_line_exchange_code_round_trips_to_the_token():
    from apps.accounts.services import AuthService

    code = AuthService.issue_line_exchange_code("raw-token-abc")
    assert AuthService.consume_line_exchange_code(code) == "raw-token-abc"


@pytest.mark.unit
def test_line_exchange_code_is_single_use():
    from ninja.errors import HttpError

    from apps.accounts.services import AuthService

    code = AuthService.issue_line_exchange_code("raw-token-abc")
    AuthService.consume_line_exchange_code(code)
    with pytest.raises(HttpError):
        AuthService.consume_line_exchange_code(code)


@pytest.mark.unit
def test_line_exchange_code_unknown_code_rejected():
    from ninja.errors import HttpError

    from apps.accounts.services import AuthService

    with pytest.raises(HttpError):
        AuthService.consume_line_exchange_code("never-issued")


@pytest.mark.unit
def test_populate_user_assigns_random_username():
    from allauth.socialaccount.models import SocialAccount, SocialLogin
    from django.contrib.auth.models import User

    from apps.accounts.adapters import LineSocialAccountAdapter

    account = SocialAccount(provider="line", uid="U-new-user", extra_data={"displayName": "New User"})
    sociallogin = SocialLogin(user=User(), account=account)

    user = LineSocialAccountAdapter().populate_user(request=None, sociallogin=sociallogin, data={})  # type: ignore[arg-type]

    assert user.username
    assert len(user.username) == 36  # uuid4 string length


@pytest.mark.integration
def test_save_user_creates_line_profile_for_new_signup(db, rf):
    from allauth.socialaccount.models import SocialAccount, SocialLogin
    from django.contrib.auth.models import User

    from apps.accounts.adapters import LineSocialAccountAdapter
    from apps.accounts.models import LineProfile

    account = SocialAccount(
        provider="line", uid="U-brand-new", extra_data={"displayName": "Brand New", "pictureUrl": "https://x/p.jpg"}
    )
    sociallogin = SocialLogin(user=User(username="placeholder"), account=account)
    request = rf.get("/accounts/line/login/callback/")
    # RequestFactory requests skip SessionMiddleware; allauth's own
    # SocialLogin.save() -> setup_user_email() reads/writes
    # request.session (dict-like .get()/[]=) regardless of our adapter. A
    # plain dict satisfies that usage without pulling in real session
    # middleware.
    request.session = {}

    adapter = LineSocialAccountAdapter()
    user = adapter.save_user(request, sociallogin)

    profile = LineProfile.objects.get(user=user)
    assert profile.line_user_id == "U-brand-new"
    assert profile.display_name == "Brand New"
    assert profile.picture_url == "https://x/p.jpg"


@pytest.mark.integration
def test_pre_social_login_refreshes_profile_for_existing_user(user):
    from allauth.socialaccount.models import SocialAccount, SocialLogin

    from apps.accounts.adapters import LineSocialAccountAdapter
    from apps.accounts.models import LineProfile

    LineProfile.objects.create(user=user, line_user_id="U-existing", display_name="Old Name", picture_url="")

    account = SocialAccount(
        provider="line", uid="U-existing", extra_data={"displayName": "New Name", "pictureUrl": "https://x/new.jpg"}
    )
    sociallogin = SocialLogin(user=user, account=account)
    sociallogin.state = {"process": "login"}
    # SocialLogin.is_existing actually keys off `user.pk` (see
    # allauth/socialaccount/models.py), not `account.pk` — the `user` fixture is
    # already a saved row, so is_existing is True here with no extra setup needed.

    LineSocialAccountAdapter().pre_social_login(request=None, sociallogin=sociallogin)  # type: ignore[arg-type]

    profile = LineProfile.objects.get(user=user)
    assert profile.display_name == "New Name"
    assert profile.picture_url == "https://x/new.jpg"


@pytest.mark.integration
def test_get_login_redirect_url_issues_token_and_exchange_code(user, rf, settings):
    from apps.accounts.adapters import LineAccountAdapter
    from apps.accounts.services import AuthService

    settings.FRONTEND_BASE_URL = "https://frontend.example.com"
    request = rf.get("/accounts/line/login/callback/")
    request.user = user

    url = LineAccountAdapter().get_login_redirect_url(request)

    assert url.startswith("https://frontend.example.com/login/callback?code=")
    code = url.split("code=", 1)[1]
    token = AuthService.consume_line_exchange_code(code)
    assert token


@pytest.mark.integration
def test_line_exchange_sets_cookie_no_token_in_body(user):
    from django.conf import settings

    from apps.accounts.services import AuthService

    token = AuthService.issue_token(user)
    code = AuthService.issue_line_exchange_code(token)

    resp = Client().post("/auth/line/exchange", data={"code": code}, content_type="application/json")

    assert resp.status_code == 200
    assert resp.json()["data"] is None
    assert token not in resp.content.decode()
    cookie = resp.cookies[settings.AUTH_COOKIE_NAME]
    assert cookie.value == token
    assert cookie["httponly"]


@pytest.mark.integration
def test_line_exchange_requires_csrf(user):
    from apps.accounts.services import AuthService

    code = AuthService.issue_line_exchange_code(AuthService.issue_token(user))
    c = Client(enforce_csrf_checks=True)

    resp = c.post("/auth/line/exchange", data={"code": code}, content_type="application/json")
    assert resp.status_code == 403
    assert resp.json()["error"]["reason"] == "csrf_failed"

    # A CSRF failure must not burn the one-time code: the retry with a token succeeds.
    csrf = c.get("/auth/csrf").json()["data"]["csrf_token"]
    resp = c.post(
        "/auth/line/exchange", data={"code": code}, content_type="application/json", headers={"X-CSRFToken": csrf}
    )
    assert resp.status_code == 200


@pytest.mark.integration
def test_line_exchange_rejects_unknown_code(db):
    resp = Client().post("/auth/line/exchange", data={"code": "bogus"}, content_type="application/json")
    assert resp.status_code == 401


@pytest.mark.integration
def test_me_includes_line_profile_when_present(user, auth_headers):
    from apps.accounts.models import LineProfile

    LineProfile.objects.create(user=user, line_user_id="U1", display_name="Alice L", picture_url="https://x/a.jpg")

    resp = Client().get("/auth/me", headers=auth_headers)

    assert resp.status_code == 200
    body = resp.json()["data"]
    assert body["display_name"] == "Alice L"
    assert body["picture_url"] == "https://x/a.jpg"


@pytest.mark.integration
def test_me_omits_line_profile_when_absent(user, auth_headers):
    resp = Client().get("/auth/me", headers=auth_headers)

    assert resp.status_code == 200
    body = resp.json()["data"]
    assert body["display_name"] is None
    assert body["picture_url"] is None


@pytest.mark.integration
def test_register_and_login_endpoints_are_gone(db):
    client = Client()
    assert client.post("/auth/register", data={}, content_type="application/json").status_code == 404
    assert client.post("/auth/login", data={}, content_type="application/json").status_code == 404


@pytest.mark.integration
def test_on_authentication_error_redirects_to_frontend_login(db, settings):
    from allauth.core.exceptions import ImmediateHttpResponse

    from apps.accounts.adapters import LineSocialAccountAdapter

    settings.FRONTEND_BASE_URL = "https://frontend.example.com"

    with pytest.raises(ImmediateHttpResponse) as exc_info:
        LineSocialAccountAdapter().on_authentication_error(request=None, provider=None, error="access_denied")  # type: ignore[arg-type]

    response = exc_info.value.response
    assert response.status_code == 302
    assert response["Location"] == "https://frontend.example.com/login?error=line_auth_failed"


@pytest.mark.integration
def test_authentication_error_view_redirects_browser_to_frontend_login(db, settings):
    """End-to-end: allauth's error path (e.g. user cancels LINE consent) lands
    the browser back on the SPA, not on an unstyled backend-origin page."""
    from allauth.socialaccount.helpers import render_authentication_error

    settings.FRONTEND_BASE_URL = "https://frontend.example.com"

    from django.test import RequestFactory

    request = RequestFactory().get("/accounts/line/login/callback/")

    response = render_authentication_error(request, provider="line")

    assert response.status_code == 302
    assert response["Location"] == "https://frontend.example.com/login?error=line_auth_failed"


# ==================== RBAC (roles.py / require_role) ====================


@pytest.mark.integration
def test_role_groups_are_created_by_migration(db):
    from django.contrib.auth.models import Group

    from apps.accounts.roles import GROUP_BACKED_ROLES

    assert set(Group.objects.values_list("name", flat=True)) >= {r.value for r in GROUP_BACKED_ROLES}


@pytest.mark.integration
def test_every_active_user_has_user_role(user):
    from apps.accounts.roles import Role, get_user_roles

    assert get_user_roles(user) == [Role.USER]


@pytest.mark.integration
def test_admin_group_and_superuser_grant_admin_role(staff_admin, admin_user):
    from apps.accounts.roles import Role, get_user_roles, has_role

    assert get_user_roles(staff_admin) == [Role.ADMIN, Role.USER]
    assert get_user_roles(admin_user) == [Role.ADMIN, Role.USER]  # superuser implies admin, no group needed
    assert has_role(staff_admin, Role.ADMIN)


@pytest.mark.integration
def test_unknown_groups_and_inactive_users_grant_nothing(user):
    from django.contrib.auth.models import AnonymousUser, Group

    from apps.accounts.roles import Role, get_user_roles

    user.groups.add(Group.objects.create(name="can-edit-in-admin"))
    assert get_user_roles(user) == [Role.USER]  # admin-permission groups are not API roles
    user.is_active = False
    assert get_user_roles(user) == []
    assert get_user_roles(AnonymousUser()) == []
    assert get_user_roles(None) == []


@pytest.mark.integration
def test_me_returns_roles(staff_admin, admin_auth_headers, auth_headers):
    me = Client().get("/auth/me", headers=admin_auth_headers).json()["data"]
    assert me["roles"] == ["admin", "user"]
    assert Client().get("/auth/me", headers=auth_headers).json()["data"]["roles"] == ["user"]


@pytest.mark.integration
def test_require_role_401_403_200(user, auth_headers, admin_auth_headers):
    url = "/notifications/failed"  # first require_role(Role.ADMIN) endpoint
    assert Client().get(url).status_code == 401

    forbidden = Client().get(url, headers=auth_headers)
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["reason"] == "permission_denied"

    assert Client().get(url, headers=admin_auth_headers).status_code == 200


@pytest.mark.unit
def test_require_role_needs_a_role():
    from apps.accounts.authentication import require_role

    with pytest.raises(ValueError, match="at least one role"):
        require_role()


# ==================== Audit: LINE login / logout ====================


@pytest.mark.integration
def test_line_login_success_is_audited(user, rf):
    from apps.accounts.adapters import LineAccountAdapter
    from apps.audit.models import AuditLog

    request = rf.get("/accounts/line/login/callback/")
    request.user = user
    LineAccountAdapter().get_login_redirect_url(request)

    entry = AuditLog.objects.get(action=AuditLog.Action.LINE_LOGIN_SUCCESS)
    assert entry.actor_id == user.id


@pytest.mark.integration
def test_line_login_failure_is_audited_without_actor(db, settings):
    from allauth.socialaccount.helpers import render_authentication_error
    from django.test import RequestFactory

    from apps.audit.models import AuditLog

    render_authentication_error(
        RequestFactory().get("/accounts/line/login/callback/"), provider="line", error="cancelled"
    )

    entry = AuditLog.objects.get(action=AuditLog.Action.LINE_LOGIN_FAILED)
    assert entry.actor is None
    assert entry.metadata["error"] == "cancelled"


@pytest.mark.integration
def test_logout_is_audited(user, auth_headers):
    from apps.audit.models import AuditLog

    assert Client().post("/auth/logout", headers=auth_headers).status_code == 200
    entry = AuditLog.objects.get(action=AuditLog.Action.LOGOUT)
    assert entry.actor_id == user.id
    assert entry.metadata["tokens_revoked"] == 1


# ---------------------------------------------------------------------------
# HttpOnly cookie auth + CSRF (BearerAuth falls back to the auth cookie)
# ---------------------------------------------------------------------------
def _cookie_client(raw, enforce=True):
    """Client carrying the auth cookie; Django's test Client skips CSRF unless asked, so enforce it."""
    from django.conf import settings

    c = Client(enforce_csrf_checks=enforce)
    c.cookies[settings.AUTH_COOKIE_NAME] = raw
    return c


@pytest.mark.integration
def test_csrf_endpoint_returns_token_and_sets_cookie(db):
    resp = Client().get("/auth/csrf")
    assert resp.status_code == 200
    assert resp.json()["data"]["csrf_token"]
    assert "csrftoken" in resp.cookies


@pytest.mark.integration
def test_cookie_auth_get_me_without_csrf(user):
    from apps.accounts.services import AuthService

    raw = AuthService.issue_token(user)
    assert _cookie_client(raw).get("/auth/me").json()["data"]["username"] == "alice"


@pytest.mark.integration
def test_cookie_auth_post_without_csrf_is_403_csrf_failed(user):
    from apps.accounts.services import AuthService

    raw = AuthService.issue_token(user)
    resp = _cookie_client(raw).post("/auth/logout")
    assert resp.status_code == 403
    assert resp.json()["error"]["reason"] == "csrf_failed"


@pytest.mark.integration
def test_cookie_auth_post_with_csrf_succeeds(user):
    from apps.accounts.services import AuthService

    c = _cookie_client(AuthService.issue_token(user))
    token = c.get("/auth/csrf").json()["data"]["csrf_token"]
    assert c.post("/auth/logout", headers={"X-CSRFToken": token}).status_code == 200


@pytest.mark.integration
def test_cookie_logout_clears_cookie_and_revokes_token(user):
    from django.conf import settings

    from apps.accounts.services import AuthService

    raw = AuthService.issue_token(user)
    c = _cookie_client(raw)
    token = c.get("/auth/csrf").json()["data"]["csrf_token"]

    resp = c.post("/auth/logout", headers={"X-CSRFToken": token})

    assert resp.status_code == 200
    assert resp.cookies[settings.AUTH_COOKIE_NAME]["max-age"] == 0
    # A replayed copy of the old cookie is dead server-side, not just deleted client-side.
    assert _cookie_client(raw).get("/auth/me").status_code == 401


@pytest.mark.integration
def test_anonymous_post_without_cookie_is_401_not_403(db):
    resp = Client(enforce_csrf_checks=True).post("/auth/logout")
    assert resp.status_code == 401


@pytest.mark.integration
def test_bearer_header_wins_over_cookie_and_skips_csrf(user, auth_headers):
    c = _cookie_client("garbage")
    assert c.post("/auth/logout", headers=auth_headers).status_code == 200


@pytest.mark.integration
def test_expired_cookie_token_is_401(user):
    from datetime import timedelta

    from django.utils import timezone

    from apps.accounts.models import AuthToken
    from apps.core.security import generate_token

    raw, digest = generate_token()
    AuthToken.objects.create(user=user, digest=digest, expiry=timezone.now() - timedelta(minutes=1))

    assert _cookie_client(raw).get("/auth/me").status_code == 401


@pytest.mark.unit
def test_auth_cookie_helpers_set_and_clear_attributes():
    from django.conf import settings
    from django.http import HttpResponse

    from apps.accounts.authentication import clear_auth_cookie, set_auth_cookie

    resp = HttpResponse()
    set_auth_cookie(resp, "raw-token")
    cookie = resp.cookies[settings.AUTH_COOKIE_NAME]
    assert cookie.value == "raw-token"
    assert cookie["httponly"] is True
    assert cookie["samesite"] == "Lax"
    assert cookie["path"] == "/"
    assert not cookie["domain"]
    assert cookie["max-age"] == settings.AUTH_TOKEN_TTL_DAYS * 86400
    assert bool(cookie["secure"]) is settings.AUTH_COOKIE_SECURE

    clear_auth_cookie(resp)
    assert resp.cookies[settings.AUTH_COOKIE_NAME]["max-age"] == 0


@pytest.mark.unit
def test_frontend_origin_is_csrf_trusted():
    from django.conf import settings

    assert set(settings.CORS_ALLOWED_ORIGINS) <= set(settings.CSRF_TRUSTED_ORIGINS)
