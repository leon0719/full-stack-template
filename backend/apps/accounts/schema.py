from ninja import Schema
from pydantic import Field

from apps.accounts.roles import Role


class TokenResponse(Schema):
    token: str


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
