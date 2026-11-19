from django.http import HttpResponse
from django.middleware.csrf import get_token
from loguru import logger
from ninja import Router

from apps.accounts.authentication import BearerAuth, clear_auth_cookie, require_csrf, set_auth_cookie
from apps.accounts.roles import get_user_roles
from apps.accounts.schema import CsrfResponse, LineExchangeRequest, MeResponse
from apps.accounts.services import AuthService
from apps.core.schema import BaseResponse
from apps.core.throttling import LoginThrottle

auth_router = Router(tags=["auth"])


@auth_router.post("/line/exchange", response=BaseResponse[None], throttle=[LoginThrottle()])
def line_exchange(request, payload: LineExchangeRequest, response: HttpResponse):
    """Trade a one-time LINE-login exchange code for a session: the token goes into the HttpOnly auth
    cookie, never the body. Browser endpoint (CSRF-checked, before the code is consumed)."""
    require_csrf(request)
    set_auth_cookie(response, AuthService.consume_line_exchange_code(payload.code, request.session))
    return BaseResponse()


@auth_router.post("/logout", response=BaseResponse[None], auth=BearerAuth())
def logout(request, response: HttpResponse):
    """Global logout: revoke ALL tokens belonging to the current user, and clear the auth cookie.

    This invalidates every session/device at once — not just the token presented
    in this request. Clients holding other tokens for this user will start
    receiving 401 and must log in again.
    """
    AuthService.logout(request.auth)
    clear_auth_cookie(response)
    return BaseResponse()


@auth_router.get("/csrf", response=BaseResponse[CsrfResponse], auth=None)
def csrf(request):
    """Return a CSRF token (and set the ``csrftoken`` cookie). Cookie-authenticated unsafe requests
    must echo it in ``X-CSRFToken``. Refetch after a ``csrf_failed``: the token goes stale when Django ``login()``
    runs on the API host (admin, allauth callback) or the ``csrftoken`` cookie expires."""
    return BaseResponse(data=CsrfResponse(csrf_token=get_token(request)))


@auth_router.get("/me", response=BaseResponse[MeResponse], auth=BearerAuth())
def me(request):
    """Return the authenticated user's profile: LINE display name / avatar if present, and ``roles``
    (see ``apps/accounts/roles.py``)."""
    user = request.auth
    line_profile = getattr(user, "line_profile", None)
    logger.info("[View] profile read - user_id: {uid}", uid=user.id)
    return BaseResponse(
        data=MeResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            display_name=line_profile.display_name if line_profile else None,
            picture_url=line_profile.picture_url if line_profile else None,
            roles=get_user_roles(user),
        )
    )
