"""Django admin 登入的稽核。LINE Login 的成功/失敗由 ``apps/accounts/adapters.py`` 自己記。

allauth 完成 LINE 登入時同樣會呼叫 ``auth.login()``(送出 ``user_logged_in``),所以這裡只認
「路徑在 admin 底下」的請求,避免 LINE 登入被重複記成 admin 登入。
"""

from django.contrib.auth.base_user import AbstractBaseUser
from django.contrib.auth.signals import user_logged_in, user_login_failed
from django.dispatch import receiver
from django.http import HttpRequest
from django.urls import NoReverseMatch, reverse

from apps.audit.models import AuditLog


def _is_admin_request(request: HttpRequest | None) -> bool:
    if request is None:
        return False
    try:
        admin_prefix = reverse("admin:index")
    except NoReverseMatch:  # admin removed from urls.py — nothing to audit
        return False
    return request.path.startswith(admin_prefix)


@receiver(user_logged_in)
def audit_admin_login(sender: type, request: HttpRequest | None, user: AbstractBaseUser, **kwargs: object) -> None:
    if _is_admin_request(request):
        AuditLog.record(AuditLog.Action.ADMIN_LOGIN_SUCCESS, user=user)


@receiver(user_login_failed)
def audit_admin_login_failed(sender: str, request: HttpRequest | None = None, **kwargs: object) -> None:
    # Submitted credentials are never recorded: the username field often holds a password.
    if _is_admin_request(request):
        AuditLog.record(AuditLog.Action.ADMIN_LOGIN_FAILED)
