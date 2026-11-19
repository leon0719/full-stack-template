"""Business logic for authentication / token lifecycle."""

import secrets
from datetime import timedelta
from typing import cast

from django.conf import settings
from django.contrib.auth.models import User
from django.contrib.sessions.backends.base import SessionBase
from django.core.cache import cache
from django.utils import timezone
from loguru import logger

from apps.accounts.models import AuthToken
from apps.audit.models import AuditLog
from apps.core.security import generate_token
from config.errors import AppError, ErrorCode

_LINE_EXCHANGE_CACHE_PREFIX = "line-exchange:"
_LINE_EXCHANGE_CODE_TTL_SECONDS = 60
# Session key binding the exchange code to the browser that finished the LINE OAuth flow.
_LINE_EXCHANGE_SESSION_KEY = "line_exchange_code"


class AuthService:
    @staticmethod
    def issue_token(user: User) -> str:
        raw, digest = generate_token()
        ttl_days = settings.AUTH_TOKEN_TTL_DAYS
        AuthToken.objects.create(
            user=user,
            digest=digest,
            expiry=timezone.now() + timedelta(days=ttl_days),
        )
        logger.info("[Service] token issued - user_id: {uid}", uid=user.pk)
        return raw

    @staticmethod
    def issue_line_exchange_code(token: str, session: SessionBase) -> str:
        """Stash a freshly issued bearer token behind a one-time, short-lived code.

        Used so the LINE-login redirect never carries the raw token in a URL
        (query strings leak via Referer headers and browser history).

        The code is also written to the API-host session of the browser that just finished
        the OAuth flow, and only that session can redeem it. Without this, an attacker could
        hand their own code to a victim and silently log the victim into the attacker's account
        (login CSRF): CSRF on the exchange proves same-site, not same browser.
        """
        code = secrets.token_urlsafe(32)
        cache.set(f"{_LINE_EXCHANGE_CACHE_PREFIX}{code}", token, timeout=_LINE_EXCHANGE_CODE_TTL_SECONDS)
        session[_LINE_EXCHANGE_SESSION_KEY] = code
        logger.info("[Service] LINE exchange code issued")
        return code

    @staticmethod
    def consume_line_exchange_code(code: str, session: SessionBase) -> str:
        bound = session.pop(_LINE_EXCHANGE_SESSION_KEY, None)
        if bound is None or not secrets.compare_digest(bound, code):
            logger.warning("[Service] LINE exchange code not bound to this session")
            raise AppError(401, ErrorCode.INVALID_EXCHANGE_CODE, "Invalid or expired code")
        key = f"{_LINE_EXCHANGE_CACHE_PREFIX}{code}"
        token = cache.get(key)
        # delete() reports whether this call removed the key, so two racing requests cannot both redeem it.
        if token is None or not cache.delete(key):
            logger.warning("[Service] LINE exchange code invalid or expired")
            raise AppError(401, ErrorCode.INVALID_EXCHANGE_CODE, "Invalid or expired code")
        return cast("str", token)

    @staticmethod
    def logout(user: User) -> int:
        deleted, _ = AuthToken.objects.filter(user=user).delete()
        logger.info("[Service] logout - user_id: {uid}, tokens_revoked: {n}", uid=user.pk, n=deleted)
        AuditLog.record(AuditLog.Action.LOGOUT, user=user, tokens_revoked=deleted)
        return deleted
