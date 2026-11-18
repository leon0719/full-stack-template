"""Opaque bearer-token authentication for Django Ninja.

A raw token is issued at login (see ``services.AuthService.issue_token``); only its
SHA-256 digest is stored. ``BearerAuth.authenticate`` hashes the incoming token, looks
up the matching row, validates expiry/active-state, and exposes the user as
``request.auth`` (also set on ``request.user``).

Browsers authenticate with the same raw token in an HttpOnly cookie instead of an
``Authorization`` header (``BearerAuth`` falls back to it; ``set_auth_cookie`` /
``clear_auth_cookie`` write it). Cookies are sent automatically cross-site, so the
cookie path also enforces CSRF on unsafe methods (``require_csrf``); the header path
needs no CSRF check.

``require_role(Role.ADMIN)`` is ``BearerAuth`` plus a role check (roles = Django groups,
see ``apps/accounts/roles.py``).
"""

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser
from django.http import HttpRequest, HttpResponse
from django.utils import timezone
from loguru import logger
from ninja.security import HttpBearer
from ninja.utils import check_csrf

from apps.accounts.models import AuthToken
from apps.accounts.roles import Role, has_role
from apps.core.security import hash_token
from config.errors import AppError, ErrorCode


def require_csrf(request: HttpRequest) -> None:
    """Django's CSRF check (safe methods always pass); failure → 403 ``csrf_failed``, never a bare ``None``
    (ninja would turn that into 401 and the client could not tell it to refetch the CSRF token)."""
    if check_csrf(request) is not None:
        logger.warning("[Auth] CSRF check failed - {method} {path}", method=request.method, path=request.path)
        raise AppError(403, ErrorCode.CSRF_FAILED, "CSRF check failed")


def set_auth_cookie(response: HttpResponse, raw_token: str) -> None:
    response.set_cookie(
        settings.AUTH_COOKIE_NAME,
        raw_token,
        max_age=settings.AUTH_TOKEN_TTL_DAYS * 86400,
        secure=settings.AUTH_COOKIE_SECURE,
        httponly=True,
        samesite="Lax",
        path="/",
    )


def clear_auth_cookie(response: HttpResponse) -> None:
    response.delete_cookie(settings.AUTH_COOKIE_NAME, path="/", samesite="Lax")


class BearerAuth(HttpBearer):
    def __call__(self, request: HttpRequest) -> AbstractBaseUser | None:
        # Not APIKeyCookie: it checks CSRF BEFORE reading the cookie, so an anonymous POST would be 403, not 401.
        if request.headers.get(self.header):  # header wins; the cookie is ignored (and needs no CSRF)
            return super().__call__(request)
        raw = request.COOKIES.get(settings.AUTH_COOKIE_NAME)
        if not raw:
            return None
        if not getattr(request, "_ninja_csrf_exempt", False):
            require_csrf(request)
        return self.authenticate(request, raw)

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
