"""Unified exception handlers for Django Ninja API."""

from typing import Any

import sentry_sdk
from django.core.exceptions import PermissionDenied
from django.http import Http404, HttpRequest, HttpResponse
from loguru import logger
from ninja import NinjaAPI
from ninja.errors import AuthenticationError, ValidationError

# Pydantic error dicts carry the offending value under "input" (and sometimes
# "ctx"). Echoing it back would put raw request data — including passwords that
# failed validation — into response bodies and any middleware/proxy logs.
_SAFE_ERROR_KEYS = ("type", "loc", "msg")


def _sanitize_errors(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: e[k] for k in _SAFE_ERROR_KEYS if k in e} for e in errors]


def register_exception_handlers(api: NinjaAPI) -> None:
    """Register all custom exception handlers on the given NinjaAPI instance."""

    @api.exception_handler(ValidationError)
    def validation_error(request: HttpRequest, exc: ValidationError) -> HttpResponse:
        return api.create_response(
            request,
            {"detail": "Validation error", "errors": _sanitize_errors(exc.errors)},
            status=422,
        )

    @api.exception_handler(AuthenticationError)
    def authentication_error(request: HttpRequest, exc: AuthenticationError) -> HttpResponse:
        return api.create_response(
            request,
            {"detail": "Authentication required"},
            status=401,
        )

    @api.exception_handler(PermissionDenied)
    def permission_denied(request: HttpRequest, exc: PermissionDenied) -> HttpResponse:
        return api.create_response(
            request,
            {"detail": "Permission denied"},
            status=403,
        )

    @api.exception_handler(Http404)
    def not_found(request: HttpRequest, exc: Http404) -> HttpResponse:
        return api.create_response(
            request,
            {"detail": "Not found"},
            status=404,
        )

    @api.exception_handler(Exception)
    def internal_error(request: HttpRequest, exc: Exception) -> HttpResponse:
        logger.exception("Unhandled exception on {method} {path}", method=request.method, path=request.path)
        # loguru does not feed Sentry's LoggingIntegration, so report explicitly.
        # No-op when Sentry is not initialised (no DSN configured).
        sentry_sdk.capture_exception(exc)
        return api.create_response(
            request,
            {"detail": "Internal server error"},
            status=500,
        )
