"""Decorators for resilient third-party HTTP calls.

All outbound ``httpx`` calls should live in an app's ``external_services.py`` and be
wrapped with one of these decorators so retries, logging and error translation are
handled consistently:

- ``@handle_api_call`` — strict: exhausts retries then raises ``HttpError`` (the
  caller / global exception handler turns it into a proper HTTP response).
- ``@handle_api_call_graceful`` — lenient: on failure logs and returns ``default_return``
  (use for non-critical, best-effort calls).

Retry/backoff is provided by ``tenacity``; transient errors (timeouts, connection
errors) are retried with exponential backoff, 4xx/5xx HTTP errors are not.
"""

import functools
from collections.abc import Callable
from typing import Any, TypeVar

import httpx
from loguru import logger
from ninja.errors import HttpError
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


def _retrying(max_retries: int, max_time: int, exceptions: tuple[type[Exception], ...]) -> Callable[[F], F]:
    """Shared tenacity retry policy: exponential backoff on transient errors, then reraise."""
    return retry(  # type: ignore[return-value]
        stop=(stop_after_attempt(max_retries) | stop_after_delay(max_time)),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type(exceptions),
        reraise=True,
        before_sleep=_log_retry,
    )


def handle_api_call(
    service_name: str,
    *,
    max_retries: int = 3,
    max_time: int = 30,
    timeout_code: int = 504,
    error_code: int = 502,
    retry_exceptions: tuple[type[Exception], ...] | None = None,
) -> Callable[[F], F]:
    """Wrap a third-party call: retry transient errors, then raise ``HttpError``."""
    exceptions = retry_exceptions or _DEFAULT_RETRY_EXCEPTIONS

    def decorator(func: F) -> F:
        # Retry must wrap the *raw* function: tenacity matches on the original
        # httpx exceptions, so translation to HttpError happens only after
        # retries are exhausted (translating first would defeat the retry).
        retrying_func = _retrying(max_retries, max_time, exceptions)(func)

        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return retrying_func(*args, **kwargs)
            except httpx.TimeoutException as e:
                logger.error("[External] {svc} timeout - fn: {fn}", svc=service_name, fn=func.__name__)
                raise HttpError(timeout_code, f"{service_name} timeout") from e
            except httpx.TransportError as e:
                # Connection/network failures (incl. ConnectError) after retries.
                logger.error(
                    "[External] {svc} transport error - fn: {fn}, error: {err}",
                    svc=service_name,
                    fn=func.__name__,
                    err=e,
                )
                raise HttpError(error_code, f"{service_name} unavailable") from e
            except httpx.HTTPStatusError as e:
                status = e.response.status_code
                is_client_error = 400 <= status < 500
                log = logger.warning if is_client_error else logger.error
                log(
                    "[External] {svc} HTTP {status} - fn: {fn}, body: {body}",
                    svc=service_name,
                    status=status,
                    fn=func.__name__,
                    body=e.response.text[:200],
                )
                raise HttpError(error_code, f"{service_name} error: {status}") from e

        return wrapper  # type: ignore[return-value]

    return decorator


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
        retrying_func = _retrying(max_retries, max_time, exceptions)(func)

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
