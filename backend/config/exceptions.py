"""Unified exception handlers: every API error leaves as a ``BaseResponse`` envelope.

{"data": null, "error": {"code": <HTTP status>, "message": "...", "reason": "<ErrorCode>" | null}}
"""

import math
from typing import Any

import sentry_sdk
from django.core.exceptions import PermissionDenied, RequestDataTooBig, SuspiciousOperation
from django.http import Http404, HttpRequest, HttpResponse
from loguru import logger
from ninja import NinjaAPI
from ninja.errors import AuthenticationError, HttpError, Throttled, ValidationError

from config.errors import AppError, ErrorCode


def error_body(status: int, message: str, reason: ErrorCode | None = None) -> dict[str, Any]:
    """The one place the error envelope is built (also used by ``config/urls.py`` handlers)."""
    return {"data": None, "error": {"code": status, "message": message, "reason": reason}}


def _validation_message(errors: list[dict[str, Any]]) -> str:
    # Only field location + reason. Pydantic error dicts also carry the offending
    # value under "input"/"ctx"; echoing it would put raw request data — including
    # passwords that failed validation — into response bodies and proxy logs.
    # loc is ("body"|"query"|..., <param name>, <field>...): keep the field path.
    return "; ".join(f"{'.'.join(str(p) for p in e['loc'][2:]) or e['loc'][-1]}: {e['msg']}" for e in errors)


def register_exception_handlers(api: NinjaAPI) -> None:
    """Register all custom exception handlers on the given NinjaAPI instance."""

    @api.exception_handler(ValidationError)
    def validation_error(request: HttpRequest, exc: ValidationError) -> HttpResponse:
        return api.create_response(
            request,
            error_body(422, _validation_message(exc.errors), ErrorCode.VALIDATION_ERROR),
            status=422,
        )

    @api.exception_handler(AppError)
    def app_error(request: HttpRequest, exc: AppError) -> HttpResponse:
        return api.create_response(
            request,
            error_body(exc.status_code, exc.message, exc.code),
            status=exc.status_code,
        )

    # Plain HttpError (no ErrorCode): ninja's default would render {"detail": ...}.
    # AppError/AuthenticationError/Throttled subclass it but keep their own handlers.
    @api.exception_handler(HttpError)
    def http_error(request: HttpRequest, exc: HttpError) -> HttpResponse:
        return api.create_response(request, error_body(exc.status_code, exc.message), status=exc.status_code)

    @api.exception_handler(AuthenticationError)
    def authentication_error(request: HttpRequest, exc: AuthenticationError) -> HttpResponse:
        return api.create_response(
            request,
            error_body(401, "Authentication required", ErrorCode.UNAUTHENTICATED),
            status=401,
        )

    @api.exception_handler(PermissionDenied)
    def permission_denied(request: HttpRequest, exc: PermissionDenied) -> HttpResponse:
        return api.create_response(
            request,
            error_body(403, "Permission denied", ErrorCode.PERMISSION_DENIED),
            status=403,
        )

    @api.exception_handler(Throttled)
    def throttled(request: HttpRequest, exc: Throttled) -> HttpResponse:
        response = api.create_response(
            request,
            error_body(429, "Too many requests.", ErrorCode.RATE_LIMITED),
            status=429,
        )
        # exc.wait is a fractional-second estimate from the throttle's cache
        # history; Retry-After is defined in whole seconds (RFC 9110 §10.2.3),
        # so round up rather than truncate to avoid telling clients to retry
        # a hair too early.
        if exc.wait is not None:
            response["Retry-After"] = str(math.ceil(exc.wait))
        return response

    @api.exception_handler(Http404)
    def not_found(request: HttpRequest, exc: Http404) -> HttpResponse:
        return api.create_response(
            request,
            error_body(404, "Not found", ErrorCode.NOT_FOUND),
            status=404,
        )

    # Oversized bodies surface when the parser reads request.body; without these
    # they'd fall through to the catch-all below as a 500 + Sentry event.
    @api.exception_handler(RequestDataTooBig)
    def payload_too_large(request: HttpRequest, exc: RequestDataTooBig) -> HttpResponse:
        logger.warning("Request body too large on {method} {path}", method=request.method, path=request.path)
        return api.create_response(
            request,
            error_body(413, "Request body too large", ErrorCode.PAYLOAD_TOO_LARGE),
            status=413,
        )

    @api.exception_handler(SuspiciousOperation)
    def bad_request(request: HttpRequest, exc: SuspiciousOperation) -> HttpResponse:
        logger.warning(
            "Suspicious request on {method} {path} - error: {error}",
            method=request.method,
            path=request.path,
            error=type(exc).__name__,
        )
        return api.create_response(
            request,
            error_body(400, "Bad request", ErrorCode.BAD_REQUEST),
            status=400,
        )

    @api.exception_handler(Exception)
    def internal_error(request: HttpRequest, exc: Exception) -> HttpResponse:
        logger.exception("Unhandled exception on {method} {path}", method=request.method, path=request.path)
        # loguru does not feed Sentry's LoggingIntegration, so report explicitly.
        # No-op when Sentry is not initialised (no DSN configured).
        sentry_sdk.capture_exception(exc)
        return api.create_response(
            request,
            error_body(500, "Internal server error", ErrorCode.INTERNAL_ERROR),
            status=500,
        )
