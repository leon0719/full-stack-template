from ninja import Schema
from pydantic import EmailStr, Field


class RegisterRequest(Schema):
    username: str = Field(..., min_length=3, max_length=150)
    email: EmailStr = Field(..., max_length=254)
    password: str = Field(..., min_length=8, max_length=128)


class LoginRequest(Schema):
    username: str = Field(..., max_length=150)
    password: str = Field(..., max_length=128)


class TokenResponse(Schema):
    token: str


class MeResponse(Schema):
    id: int
    username: str
    email: str
