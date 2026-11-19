"""Tests for config-level infrastructure: external API handler, exception handlers, logging, middleware."""

import importlib
import json
import logging
import time
from unittest.mock import patch

import httpx
import pytest
from django.core.exceptions import DisallowedHost
from django.http import Http404, HttpResponse
from django.test import AsyncClient, Client, RequestFactory, override_settings
from django.urls import clear_url_caches
from ninja import NinjaAPI
from ninja.errors import HttpError, Throttled

from config.errors import AppError, ErrorCode
from config.exceptions import register_exception_handlers
from config.external_api_handler import handle_api_call_graceful
from config.logging import HealthCheckFilter
from config.middleware import RequestIDMiddleware, get_request_context


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    """Neutralise tenacity's exponential backoff so retry tests run instantly."""
    monkeypatch.setattr(time, "sleep", lambda _s: None)


def _request() -> httpx.Request:
    return httpx.Request("GET", "https://api.example.com/x")


def _response(status: int) -> httpx.Response:
    return httpx.Response(status, request=_request(), text="err")


@pytest.mark.unit
def test_transient_error_is_retried_then_degraded():
    calls: list[int] = []

    @handle_api_call_graceful("svc", default_return="fallback", max_retries=3)
    def always_times_out():
        calls.append(1)
        raise httpx.ReadTimeout("slow", request=_request())

    assert always_times_out() == "fallback"  # never leaks a raw httpx exception
    assert len(calls) == 3  # retried up to max_retries, then degraded


@pytest.mark.unit
def test_http_4xx_is_not_retried():
    calls: list[int] = []

    @handle_api_call_graceful("svc", max_retries=3)
    def not_found():
        calls.append(1)
        raise httpx.HTTPStatusError("404", request=_request(), response=_response(404))

    assert not_found() is None
    assert len(calls) == 1  # HTTP status errors are permanent — no retry


@pytest.mark.unit
def test_transient_error_recovers_within_retries():
    calls: list[int] = []

    @handle_api_call_graceful("svc", max_retries=3)
    def flaky():
        calls.append(1)
        if len(calls) < 2:
            raise httpx.ConnectError("blip", request=_request())
        return "ok"

    assert flaky() == "ok"
    assert len(calls) == 2


@pytest.mark.unit
def test_graceful_returns_default_after_retries():
    calls: list[int] = []

    @handle_api_call_graceful("svc", default_return="fallback", max_retries=2)
    def always_fails():
        calls.append(1)
        raise httpx.ConnectError("down", request=_request())

    assert always_fails() == "fallback"
    assert len(calls) == 2


@pytest.mark.unit
def test_validation_error_response_never_echoes_input():
    """422 bodies must not contain the submitted values."""
    resp = Client().post(
        "/auth/line/exchange",
        data={"code": {"leaked": "hunter1-secret"}},
        content_type="application/json",
    )
    assert resp.status_code == 422
    error = resp.json()["error"]
    assert error["reason"] == "validation_error"
    assert error["message"].startswith("code:")
    assert "hunter1-secret" not in resp.content.decode()


def _access_record(args) -> logging.LogRecord:
    """Build a record shaped like uvicorn's access log: msg + 5-tuple args."""
    return logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=0,
        msg='%s - "%s %s HTTP/%s" %s',
        args=args,
        exc_info=None,
    )


@pytest.mark.unit
class TestHealthCheckFilter:
    def test_filters_health_check_path(self):
        record = _access_record(("127.0.0.1:1", "GET", "/health/live", "1.1", 200))
        assert HealthCheckFilter().filter(record) is False

    def test_filters_health_check_path_with_query_string(self):
        record = _access_record(("127.0.0.1:1", "GET", "/health/ready?verbose=1", "1.1", 200))
        assert HealthCheckFilter().filter(record) is False

    def test_keeps_other_paths(self):
        record = _access_record(("127.0.0.1:1", "GET", "/articles", "1.1", 200))
        assert HealthCheckFilter().filter(record) is True

    def test_health_path_in_query_string_is_not_filtered(self):
        """A crafted URL must not be able to suppress its own access log."""
        record = _access_record(("10.0.0.9:1", "GET", "/admin/login/?x=/health/live", "1.1", 200))
        assert HealthCheckFilter().filter(record) is True

    def test_health_path_as_prefix_is_not_filtered(self):
        record = _access_record(("127.0.0.1:1", "GET", "/health/liveness-extra", "1.1", 200))
        assert HealthCheckFilter().filter(record) is True

    def test_unexpected_args_shape_fails_open(self):
        record = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname=__file__,
            lineno=0,
            msg="GET /health/live 200",
            args=None,
            exc_info=None,
        )
        assert HealthCheckFilter().filter(record) is True

    def test_non_string_path_arg_fails_open(self):
        record = _access_record(("127.0.0.1:1", "GET", None, "1.1", 200))
        assert HealthCheckFilter().filter(record) is True


@pytest.mark.unit
def test_handler404_returns_json_envelope():
    from config.urls import handler404

    resp = handler404(RequestFactory().get("/nope"), Http404())
    assert resp.status_code == 404
    assert json.loads(resp.content) == {
        "data": None,
        "error": {"code": 404, "message": "Not found", "reason": "not_found"},
    }


@pytest.mark.unit
def test_openapi_schema_not_served_when_debug_off():
    import config.urls

    def openapi_status(debug: bool) -> int:
        # The route is decided when config.urls is imported, so rebuild it per DEBUG value.
        with override_settings(DEBUG=debug):
            importlib.reload(config.urls)
            clear_url_caches()
            return Client().get("/openapi.json").status_code

    try:
        assert openapi_status(debug=True) == 200
        assert openapi_status(debug=False) == 404
    finally:
        importlib.reload(config.urls)
        clear_url_caches()


@pytest.mark.unit
def test_app_error_gets_code_bare_http_error_does_not():
    """AppError's handler must win over the generic HttpError handler (MRO
    dispatch), and a bare HttpError (infra failures) gets ``reason: None``."""
    api = NinjaAPI()
    register_exception_handlers(api)
    request = RequestFactory().get("/")

    app_error_response = api.on_exception(request, AppError(409, ErrorCode.JOB_NOT_CANCELLABLE, "Job not cancellable"))
    assert app_error_response.status_code == 409
    assert json.loads(app_error_response.content) == {
        "data": None,
        "error": {"code": 409, "message": "Job not cancellable", "reason": "job_not_cancellable"},
    }

    bare_response = api.on_exception(request, HttpError(502, "Upstream error"))
    assert bare_response.status_code == 502
    assert json.loads(bare_response.content) == {
        "data": None,
        "error": {"code": 502, "message": "Upstream error", "reason": None},
    }


@pytest.mark.unit
def test_throttled_response_sets_retry_after_header():
    """429 responses must carry a rounded-up Retry-After so clients know when
    to retry instead of hammering the endpoint immediately."""
    api = NinjaAPI()
    register_exception_handlers(api)
    request = RequestFactory().get("/")

    # ninja's own type hint says `wait: int | None`, but SimpleRateThrottle.wait()
    # actually returns a float — exercise the real (float) shape here.
    response = api.on_exception(request, Throttled(wait=2.3))  # type: ignore[arg-type]
    assert response.status_code == 429
    assert response["Retry-After"] == "3"
    assert json.loads(response.content) == {
        "data": None,
        "error": {"code": 429, "message": "Too many requests.", "reason": "rate_limited"},
    }


@pytest.mark.unit
def test_throttled_response_without_wait_omits_retry_after_header():
    """Some throttle configs can't estimate a wait time (``wait()`` returns
    ``None``); the header must be omitted rather than sent as "None"."""
    api = NinjaAPI()
    register_exception_handlers(api)
    request = RequestFactory().get("/")

    response = api.on_exception(request, Throttled(wait=None))
    assert response.status_code == 429
    assert "Retry-After" not in response


@pytest.mark.unit
def test_oversized_json_body_returns_413_not_500(settings):
    """RequestDataTooBig is raised when the parser reads request.body; it must not hit the 500 handler."""
    from django.core.cache import cache

    cache.clear()  # login is throttled per IP; other tests may have used the bucket
    settings.DATA_UPLOAD_MAX_MEMORY_SIZE = 100
    with patch("config.exceptions.sentry_sdk.capture_exception") as capture:
        resp = Client().post(
            "/auth/line/exchange",
            data={"code": "x" * 200},
            content_type="application/json",
        )
    assert resp.status_code == 413
    assert resp.json() == {
        "data": None,
        "error": {"code": 413, "message": "Request body too large", "reason": "payload_too_large"},
    }
    capture.assert_not_called()


@pytest.mark.unit
def test_error_envelope_codes_for_suspicious_and_unhandled_exceptions():
    api = NinjaAPI()
    register_exception_handlers(api)
    request = RequestFactory().get("/")

    bad = api.on_exception(request, DisallowedHost("evil"))
    assert bad.status_code == 400
    assert json.loads(bad.content) == {
        "data": None,
        "error": {"code": 400, "message": "Bad request", "reason": "bad_request"},
    }

    with patch("config.exceptions.sentry_sdk.capture_exception"):
        boom = api.on_exception(request, RuntimeError("boom"))
    assert boom.status_code == 500
    assert json.loads(boom.content) == {
        "data": None,
        "error": {"code": 500, "message": "Internal server error", "reason": "internal_error"},
    }


@pytest.mark.unit
def test_request_context_set_only_during_request():
    captured: dict[str, str] = {}

    def view(request):
        captured.update(get_request_context())
        return HttpResponse()

    request = RequestFactory().get("/", HTTP_X_REQUEST_ID="req-123", REMOTE_ADDR="203.0.113.9")
    RequestIDMiddleware(view)(request)
    assert captured == {"request_id": "req-123", "ip": "203.0.113.9"}
    assert get_request_context() == {}


@pytest.mark.unit
async def test_request_context_propagates_to_async_view_threads():
    """ASGI path: sync middleware → async ninja view → sync_to_async helper thread."""
    captured: dict[str, str] = {}

    def check_db() -> bool:
        captured.update(get_request_context())
        return True

    with (
        patch("apps.health.views._check_database", side_effect=check_db),
        patch("apps.health.views._check_cache", return_value=True),
        patch("apps.health.views._check_celery", return_value=True),
    ):
        resp = await AsyncClient().get("/health/ready", headers={"X-Request-ID": "async-req-1"})
    assert resp.status_code == 200
    assert captured == {"request_id": "async-req-1", "ip": "127.0.0.1"}
