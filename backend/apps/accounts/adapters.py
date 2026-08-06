"""Custom django-allauth adapters wiring LINE Login into the existing opaque
bearer token system.

``LineSocialAccountAdapter`` keeps ``LineProfile`` (display name / avatar) in
sync with what LINE returns. ``LineAccountAdapter`` overrides the post-login
redirect so the browser is sent back to the frontend with a one-time exchange
code instead of allauth's own session — this app never uses allauth's session
or headless token machinery, only its OAuth client + provider plumbing.
"""

import uuid
from typing import Any, cast

from allauth.account.adapter import DefaultAccountAdapter
from allauth.core.exceptions import ImmediateHttpResponse
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from allauth.socialaccount.models import SocialLogin
from django.conf import settings
from django.contrib.auth.models import User
from django.http import HttpRequest, HttpResponseRedirect
from loguru import logger

from apps.accounts.models import LineProfile
from apps.accounts.services import AuthService


class LineSocialAccountAdapter(DefaultSocialAccountAdapter):
    def populate_user(self, request: HttpRequest, sociallogin: SocialLogin, data: dict[str, Any]):
        user = super().populate_user(request, sociallogin, data)
        # LINE has no username concept; Django's User requires a unique one.
        # The display name is user-visible profile data (LineProfile), never
        # used as the login identifier.
        user.username = str(uuid.uuid4())
        return user

    def pre_social_login(self, request: HttpRequest, sociallogin: SocialLogin) -> None:
        """Refresh LineProfile for a RETURNING user on every login.

        New-user profile creation happens in ``save_user`` instead: at this
        point in the flow a brand-new ``sociallogin.user`` has no primary key
        yet, and ``LineProfile`` cannot reference an unsaved user.
        """
        if not sociallogin.is_existing or sociallogin.account.provider != "line":
            return
        self._upsert_profile(sociallogin)

    def save_user(self, request: HttpRequest, sociallogin: SocialLogin, form=None):
        user = super().save_user(request, sociallogin, form)
        self._upsert_profile(sociallogin)
        return user

    def on_authentication_error(
        self,
        request: HttpRequest,
        provider,
        error: Any = None,
        exception: Exception | None = None,
        extra_context: dict[str, Any] | None = None,
    ) -> None:
        # Default behaviour renders socialaccount/authentication_error.html from
        # the BACKEND origin — the user (e.g. after tapping "Cancel" on LINE's
        # consent screen, or an OAuth exchange failure) would be stranded there
        # with no way back to the SPA. Redirect to the frontend instead. Log the
        # error/exception only — never anything credential-shaped (no tokens,
        # no request body).
        logger.warning(
            "[Adapter] LINE authentication error - error: {error}, exception: {exception}",
            error=error,
            exception=exception,
        )
        raise ImmediateHttpResponse(HttpResponseRedirect(f"{settings.FRONTEND_BASE_URL}/login?error=line_auth_failed"))

    @staticmethod
    def _upsert_profile(sociallogin: SocialLogin) -> None:
        extra_data = sociallogin.account.extra_data
        LineProfile.objects.update_or_create(
            user=sociallogin.user,
            defaults={
                "line_user_id": sociallogin.account.uid,
                "display_name": extra_data.get("displayName", ""),
                "picture_url": extra_data.get("pictureUrl", ""),
            },
        )
        logger.info("[Adapter] LINE profile upserted - user_id: {uid}", uid=sociallogin.user.pk)


class LineAccountAdapter(DefaultAccountAdapter):
    def get_login_redirect_url(self, request: HttpRequest) -> str:
        # This hook only fires after allauth has completed a social login, so
        # request.user is always the authenticated Django User here — never
        # AnonymousUser. Narrow the type for mypy without changing behavior.
        token = AuthService.issue_token(cast(User, request.user))
        code = AuthService.issue_line_exchange_code(token)
        return f"{settings.FRONTEND_BASE_URL}/login/callback?code={code}"
