from loguru import logger
from ninja import Router

from apps.accounts.authentication import BearerAuth
from apps.accounts.schema import LineExchangeRequest, MeResponse, TokenResponse
from apps.accounts.services import AuthService
from apps.core.schema import DetailResponse
from apps.core.throttling import LoginThrottle

auth_router = Router(tags=["auth"])


@auth_router.post("/line/exchange", response=TokenResponse, throttle=[LoginThrottle()])
def line_exchange(request, payload: LineExchangeRequest):
    """Trade a one-time LINE-login exchange code for a bearer token."""
    return TokenResponse(token=AuthService.consume_line_exchange_code(payload.code))


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
    """Return the authenticated user's profile, including LINE display name / avatar if present."""
    user = request.auth
    line_profile = getattr(user, "line_profile", None)
    logger.info("[View] profile read - user_id: {uid}", uid=user.id)
    return MeResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=line_profile.display_name if line_profile else None,
        picture_url=line_profile.picture_url if line_profile else None,
    )
