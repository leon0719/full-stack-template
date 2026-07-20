"""Opaque bearer-token authentication for Django Ninja.

A raw token is issued at login (see ``services.AuthService.issue_token``); only its
SHA-256 digest is stored. ``BearerAuth.authenticate`` hashes the incoming token, looks
up the matching row, validates expiry/active-state, and exposes the user as
``request.auth`` (also set on ``request.user``).
"""

from django.contrib.auth.models import AbstractBaseUser
from django.http import HttpRequest
from django.utils import timezone
from loguru import logger
from ninja.security import HttpBearer

from apps.accounts.models import AuthToken
from apps.core.security import hash_token


class BearerAuth(HttpBearer):
    def authenticate(self, request: HttpRequest, token: str) -> AbstractBaseUser | None:
        token_obj = AuthToken.objects.select_related("user").filter(digest=hash_token(token)).first()
        if token_obj is None:
            # Never log any part of the presented token (it is a credential).
            logger.warning("[Auth] invalid token attempt")
            return None
        if token_obj.expiry and token_obj.expiry < timezone.now():
            token_obj.delete()
            logger.warning("[Auth] expired token - user_id: {uid}", uid=token_obj.user_id)
            return None
        if not token_obj.user.is_active:
            logger.warning("[Auth] inactive user - user_id: {uid}", uid=token_obj.user_id)
            return None
        request.user = token_obj.user
        return token_obj.user
