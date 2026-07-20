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
def test_register_returns_token(db):
    client = Client()
    resp = client.post(
        "/auth/register",
        data={"username": "carol", "email": "carol@example.com", "password": "pw-12345678"},
        content_type="application/json",
    )
    assert resp.status_code == 201
    assert resp.json()["token"]


@pytest.mark.integration
@pytest.mark.parametrize(
    ("username", "password"),
    [
        ("numeric_nick", "3400987212"),  # entirely numeric → NumericPasswordValidator
        ("shorty", "pw-1"),  # too short → MinimumLengthValidator
        ("carlossantana", "carlossantana"),  # ≈ username → UserAttributeSimilarityValidator
    ],
)
def test_register_rejects_weak_password(db, username, password):
    """AUTH_PASSWORD_VALIDATORS must be enforced at register (create_user alone skips them)."""
    from django.contrib.auth.models import User

    resp = Client().post(
        "/auth/register",
        data={"username": username, "email": f"{username}@example.com", "password": password},
        content_type="application/json",
    )

    assert resp.status_code == 422
    body = resp.json()
    assert body["detail"] == "Validation error"
    assert all(error["loc"][-1] == "password" for error in body["errors"])
    # The unified 422 handler must never echo the submitted password back.
    assert password not in resp.content.decode()
    assert not User.objects.filter(username=username).exists()


@pytest.mark.integration
def test_register_accepts_strong_password(db):
    resp = Client().post(
        "/auth/register",
        data={"username": "strong_sam", "email": "sam@example.com", "password": "korrect-horse-battery"},
        content_type="application/json",
    )
    assert resp.status_code == 201
    assert resp.json()["token"]


@pytest.mark.integration
def test_register_duplicate_username_conflicts(user):
    client = Client()
    resp = client.post(
        "/auth/register",
        data={"username": user.username, "email": "dup@example.com", "password": "pw-12345678"},
        content_type="application/json",
    )
    assert resp.status_code == 409


@pytest.mark.integration
def test_login_then_access_me(user):
    client = Client()
    login = client.post(
        "/auth/login",
        data={"username": "alice", "password": "pw-12345678"},
        content_type="application/json",
    )
    assert login.status_code == 200
    token = login.json()["token"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["username"] == "alice"


@pytest.mark.integration
def test_me_requires_auth(db):
    resp = Client().get("/auth/me")
    assert resp.status_code == 401


@pytest.mark.integration
def test_login_bad_credentials(user):
    resp = Client().post(
        "/auth/login",
        data={"username": "alice", "password": "wrong"},
        content_type="application/json",
    )
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
