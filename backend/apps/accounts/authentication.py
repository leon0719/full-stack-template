"""Opaque bearer-token authentication for Django Ninja.

A raw token is issued at login (see ``services.AuthService.issue_token``); only its
SHA-256 digest is stored. ``BearerAuth.authenticate`` hashes the incoming token, looks
up the matching row, validates expiry/active-state, and exposes the user as
``request.auth`` (also set on ``request.user``).

``require_role(Role.ADMIN)`` is ``BearerAuth`` plus a role check (roles = Django groups,
see ``apps/accounts/roles.py``).
"""

from django.contrib.auth.models import AbstractBaseUser
from django.http import HttpRequest
from django.utils import timezone
from loguru import logger
from ninja.security import HttpBearer

from apps.accounts.models import AuthToken
from apps.accounts.roles import Role, has_role
from apps.core.security import hash_token
from config.errors import AppError, ErrorCode


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


class RoleBearerAuth(BearerAuth):
    """``BearerAuth`` + 角色檢查。沒帶/無效 token → 401;token 有效但缺角色 → 403
    ``permission_denied``(例外由 ninja 的 auth 流程交給 ``config/exceptions.py`` 渲染)。"""

    def __init__(self, *roles: Role) -> None:
        if not roles:
            raise ValueError("require_role() needs at least one role")
        super().__init__()
        self.roles = roles

    def authenticate(self, request: HttpRequest, token: str) -> AbstractBaseUser | None:
        user = super().authenticate(request, token)
        if user is not None and not has_role(user, *self.roles):
            logger.warning(
                "[Auth] role required - user_id: {uid}, required: {roles}", uid=user.pk, roles=list(self.roles)
            )
            raise AppError(403, ErrorCode.PERMISSION_DENIED, "Permission denied")
        return user


def require_role(*roles: Role) -> RoleBearerAuth:
    """端點/router 的角色門檻(任一角色即可):``@router.get(..., auth=require_role(Role.ADMIN))``。

    取代該端點的 ``BearerAuth()``(它本身就會驗 token),不要兩個疊在一起。
    業務邏輯內要判斷角色時用 ``apps.accounts.roles.has_role``。
    """
    return RoleBearerAuth(*roles)
