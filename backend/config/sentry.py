"""Sentry error tracking + tracing setup.

Initialised from ``config.settings.base`` only when ``SENTRY_DSN`` is set, so
local/test runs stay Sentry-free with zero config.

This project uses loguru (not stdlib logging), so we do NOT rely on Sentry's
LoggingIntegration. Coverage instead comes from:
  - Web request errors → DjangoIntegration + the 500 handler in
    ``config.exceptions`` calls ``sentry_sdk.capture_exception`` explicitly.
  - Celery task errors  → CeleryIntegration captures unhandled task exceptions.
Expected 4xx (auth/permission/404) are handled by the ninja exception handlers
and filtered out below so they never become Sentry noise.
"""

import sentry_sdk
from django.core.exceptions import PermissionDenied, SuspiciousOperation
from django.http import Http404
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.django import DjangoIntegration
from sentry_sdk.types import Event, Hint

# Client-side / expected exceptions that must never be reported as errors.
_IGNORED_EXCEPTIONS: tuple[type[BaseException], ...] = (
    Http404,
    PermissionDenied,
    SuspiciousOperation,  # includes DisallowedHost
)

# Transactions that are pure noise for tracing.
_IGNORED_TRANSACTION_PREFIXES = ("/health", "/api/docs")


def _before_send(event: Event, hint: Hint) -> Event | None:
    exc_info = hint.get("exc_info") if hint else None
    if exc_info and isinstance(exc_info[1], _IGNORED_EXCEPTIONS):
        return None
    return event


def _before_send_transaction(event: Event, hint: Hint) -> Event | None:
    name = event.get("transaction") or ""
    if name.startswith(_IGNORED_TRANSACTION_PREFIXES):
        return None
    return event


def init_sentry(
    *,
    dsn: str,
    environment: str,
    release: str,
    traces_sample_rate: float,
    profiles_sample_rate: float,
) -> None:
    """Initialise the Sentry SDK. Call once, at settings import time."""
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release or None,
        integrations=[DjangoIntegration(), CeleryIntegration()],
        traces_sample_rate=traces_sample_rate,
        profiles_sample_rate=profiles_sample_rate,
        send_default_pii=False,
        # Never ship request bodies to Sentry: a 500 on /auth/login or
        # /auth/register would otherwise carry the plaintext password. The
        # request_id already correlates each event with the structured logs, so
        # the body adds little debugging value against a real credential-leak risk.
        max_request_body_size="never",
        before_send=_before_send,
        before_send_transaction=_before_send_transaction,
    )
