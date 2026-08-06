from ninja import Schema


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
