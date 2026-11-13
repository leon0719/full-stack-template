"""角色(RBAC):角色 = Django ``Group``,外加兩條隱含規則。

- 每個啟用中的登入使用者都有 ``user``(不必加進任何 group,LINE 登入自動建立的帳號、``createsuperuser``
  建出來的帳號都一樣)。
- ``is_superuser`` 隱含 ``admin``——不然第一個 superuser 還得自己把自己加進 admin group。
- 其餘角色 = 使用者所屬、且名稱在 ``Role`` 內的 group。名稱不在 ``Role`` 的 group
  (純粹拿來掛 Django admin 權限的)不會變成 API 角色,前端的 ``Role`` 型別才不會冒出意料外的值。

新增角色:在 ``Role`` 加一個成員 + 一支建立同名 group 的 data migration(照抄
``accounts/migrations/0003_create_role_groups.py``),前端 ``shared/auth`` 的 ``Role`` 型別同步加上。
為什麼用 Group 而不是 role 欄位:見 ``docs/backend-standards.md`` 的「RBAC」列。
"""

from enum import StrEnum

from django.contrib.auth.models import AbstractBaseUser, AnonymousUser


class Role(StrEnum):
    USER = "user"
    ADMIN = "admin"


# 實際存在 DB 的 group(USER 是隱含角色,不建 group)。data migration 與測試都讀這份。
GROUP_BACKED_ROLES: tuple[Role, ...] = (Role.ADMIN,)


def get_user_roles(user: AbstractBaseUser | AnonymousUser | None) -> list[Role]:
    """回傳使用者的角色清單(排序固定,給 ``/auth/me`` 與 ``require_role`` 共用)。"""
    if user is None or not user.is_authenticated or not getattr(user, "is_active", False):
        return []
    roles = {Role.USER.value}
    if getattr(user, "is_superuser", False):
        roles.add(Role.ADMIN.value)
    known = {r.value for r in Role}
    # 一次查詢;同一個 request 內重複呼叫時用 _role_cache 避免重查。
    cached: set[str] | None = getattr(user, "_role_cache", None)
    if cached is None:
        # AbstractBaseUser 本身沒有 groups(PermissionsMixin 才有);本專案用內建 User,一定有。
        cached = set(user.groups.filter(name__in=known).values_list("name", flat=True))  # type: ignore[union-attr,attr-defined]
        user._role_cache = cached  # type: ignore[union-attr,attr-defined]
    return [Role(name) for name in sorted(roles | cached)]


def has_role(user: AbstractBaseUser | AnonymousUser | None, *roles: Role | str) -> bool:
    """使用者是否具備 ``roles`` 中任一角色(OR 語意,同前端 ``hasAnyRole``)。"""
    owned = {role.value for role in get_user_roles(user)}
    return any(str(role) in owned for role in roles)
