"""Business logic for authentication / token lifecycle."""

import secrets
from datetime import timedelta
from typing import cast

from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.utils import timezone
from loguru import logger
from ninja.errors import HttpError

from apps.accounts.models import AuthToken
from apps.core.security import generate_token

_LINE_EXCHANGE_CACHE_PREFIX = "line-exchange:"
_LINE_EXCHANGE_CODE_TTL_SECONDS = 60


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
    def issue_line_exchange_code(token: str) -> str:
        """Stash a freshly issued bearer token behind a one-time, short-lived code.

        Used so the LINE-login redirect never carries the raw token in a URL
        (query strings leak via Referer headers and browser history).
        """
        code = secrets.token_urlsafe(32)
        cache.set(f"{_LINE_EXCHANGE_CACHE_PREFIX}{code}", token, timeout=_LINE_EXCHANGE_CODE_TTL_SECONDS)
        logger.info("[Service] LINE exchange code issued")
        return code

    @staticmethod
    def consume_line_exchange_code(code: str) -> str:
        key = f"{_LINE_EXCHANGE_CACHE_PREFIX}{code}"
        token = cache.get(key)
        if token is None:
            logger.warning("[Service] LINE exchange code invalid or expired")
            raise HttpError(401, "Invalid or expired code")
        cache.delete(key)
        return cast("str", token)

    @staticmethod
    def logout(user: User) -> int:
        deleted, _ = AuthToken.objects.filter(user=user).delete()
        logger.info("[Service] logout - user_id: {uid}, tokens_revoked: {n}", uid=user.pk, n=deleted)
        return deleted
