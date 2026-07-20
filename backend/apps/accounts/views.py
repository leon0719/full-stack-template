from loguru import logger
from ninja import Router
from ninja.responses import Status

from apps.accounts.authentication import BearerAuth
from apps.accounts.schema import (
    LoginRequest,
    MeResponse,
    RegisterRequest,
    TokenResponse,
)
from apps.accounts.services import AuthService
from apps.core.schema import DetailResponse
from apps.core.throttling import LoginThrottle, RegisterThrottle

auth_router = Router(tags=["auth"])


@auth_router.post("/register", response={201: TokenResponse}, throttle=[RegisterThrottle()])
def register(request, payload: RegisterRequest):
    """Create a user and return a freshly issued token. Rate-limited per client IP."""
    user = AuthService.register(payload)
    return Status(201, TokenResponse(token=AuthService.issue_token(user)))


@auth_router.post("/login", response=TokenResponse, throttle=[LoginThrottle()])
def login(request, payload: LoginRequest):
    """Exchange credentials for a bearer token. Rate-limited per client IP."""
    return TokenResponse(token=AuthService.login(payload.username, payload.password))


@auth_router.post("/logout", response=DetailResponse, auth=BearerAuth())
def logout(request):
    """Global logout: revoke ALL tokens belonging to the current user.

    This invalidates every session/device at once — not just the token presented
    in this request. Clients holding other tokens for this user will start
    receiving 401 and must log in again.
    """
    revoked = AuthService.logout(request.auth)
    return DetailResponse(detail=f"Logged out, {revoked} token(s) revoked")


@auth_router.get("/me", response=MeResponse, auth=BearerAuth())
def me(request):
    """Return the authenticated user's profile."""
    user = request.auth
    logger.info("[View] profile read - user_id: {uid}", uid=user.id)
    return MeResponse(id=user.id, username=user.username, email=user.email)
