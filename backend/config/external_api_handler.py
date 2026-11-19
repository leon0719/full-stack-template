"""Decorator for resilient third-party HTTP calls.

All outbound ``httpx`` calls should live in an app's ``external_services.py`` and be
wrapped with ``@handle_api_call_graceful``: transient errors (timeouts, connection
errors) are retried with exponential backoff via ``tenacity``, and anything still
failing afterwards is logged and degraded to ``default_return``.

A call whose result the caller truly cannot do without should raise instead — do
that in the service layer (``AppError``/``HttpError``) where the domain meaning of
"unavailable" is known, not in a generic decorator.
"""

import functools
from collections.abc import Callable
from typing import Any, TypeVar

import httpx
from loguru import logger
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    stop_after_delay,
    wait_exponential,
)

F = TypeVar("F", bound=Callable[..., Any])

_DEFAULT_RETRY_EXCEPTIONS: tuple[type[Exception], ...] = (
    httpx.TimeoutException,
    httpx.ConnectError,
)


def _log_retry(retry_state: Any) -> None:
    logger.warning(
        "[External] retrying {fn} (attempt {n}) after error: {err}",
        fn=retry_state.fn.__name__ if retry_state.fn else "?",
        n=retry_state.attempt_number,
        err=retry_state.outcome.exception() if retry_state.outcome else None,
    )


def handle_api_call_graceful(
    service_name: str,
    *,
    default_return: Any = None,
    max_retries: int = 3,
    max_time: int = 30,
    retry_exceptions: tuple[type[Exception], ...] | None = None,
) -> Callable[[F], F]:
    """Wrap a non-critical call: retry transient errors, then return ``default_return``."""
    exceptions = retry_exceptions or _DEFAULT_RETRY_EXCEPTIONS

    def decorator(func: F) -> F:
        # Retry wraps the *raw* function: tenacity matches on the original httpx
        # exceptions, so the fallback below only runs once retries are exhausted.
        retrying_func = retry(
            stop=(stop_after_attempt(max_retries) | stop_after_delay(max_time)),
            wait=wait_exponential(multiplier=1, min=1, max=10),
            retry=retry_if_exception_type(exceptions),
            reraise=True,
            before_sleep=_log_retry,
        )(func)

        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return retrying_func(*args, **kwargs)
            except Exception as e:  # noqa: BLE001 — best-effort boundary: degrade to default
                logger.warning(
                    "[External] {svc} failed, returning default - fn: {fn}, error: {err}",
                    svc=service_name,
                    fn=func.__name__,
                    err=e,
                )
                return default_return

        return wrapper  # type: ignore[return-value]

    return decorator
