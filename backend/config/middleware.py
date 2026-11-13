"""Request/correlation ID middleware.

Assigns every request a short unique id, binds it to loguru (so every log line
emitted while handling the request carries it) and to Sentry (so errors link
back to the logs), and echoes it back in the ``X-Request-ID`` response header.

An inbound ``X-Request-ID`` is honoured for cross-service correlation, but only
if it looks safe — otherwise a fresh id is generated (never trust client input
verbatim in logs).
"""

import re
import uuid
from collections.abc import Callable
from contextvars import ContextVar

import sentry_sdk
from django.http import HttpRequest, HttpResponse
from loguru import logger

REQUEST_ID_HEADER = "X-Request-ID"
_META_KEY = "HTTP_X_REQUEST_ID"
_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,128}$")

_request_context: ContextVar[dict[str, str] | None] = ContextVar("request_context", default=None)


def get_request_context() -> dict[str, str]:
    """``request_id`` and client ``ip`` of the current request; empty dict outside a request."""
    return dict(_request_context.get() or {})


class RequestIDMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        incoming = request.META.get(_META_KEY, "").strip()
        request_id = incoming if _SAFE_ID.match(incoming) else uuid.uuid4().hex
        request.request_id = request_id  # type: ignore[attr-defined]
        # REMOTE_ADDR is already the real client: uvicorn rewrites it from
        # X-Forwarded-For for proxies trusted via FORWARDED_ALLOW_IPS.
        context_token = _request_context.set({"request_id": request_id, "ip": request.META.get("REMOTE_ADDR") or ""})
        # Bind the tag inside a fresh isolation scope so it can't leak across
        # requests: under ASGI a single event loop interleaves many requests, and
        # set_tag on the shared scope would let a later request's id overwrite (or
        # mis-attach to) an earlier one. This mirrors the per-request isolation
        # loguru.contextualize() already provides.
        try:
            with sentry_sdk.isolation_scope() as scope:
                scope.set_tag("request_id", request_id)
                with logger.contextualize(request_id=request_id):
                    response = self.get_response(request)
        finally:
            _request_context.reset(context_token)
        response[REQUEST_ID_HEADER] = request_id
        return response
