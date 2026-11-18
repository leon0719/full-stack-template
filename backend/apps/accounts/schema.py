from ninja import Schema
from pydantic import Field

from apps.accounts.roles import Role


class CsrfResponse(Schema):
    csrf_token: str = Field(
        ..., description="放在不安全方法(POST/PUT/PATCH/DELETE)的 X-CSRFToken header;同時會設 csrftoken cookie。"
    )


class LineExchangeRequest(Schema):
    code: str


class MeResponse(Schema):
    id: int
    username: str
    email: str
    display_name: str | None = None
    picture_url: str | None = None
    roles: list[Role] = Field(
        ..., description="角色清單(前端 usePermission / RequireRole 用);每個登入使用者都有 user。"
    )
