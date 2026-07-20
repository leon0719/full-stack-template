"""Tests for config-level infrastructure: external API handler, exception handlers, logging."""

import logging
import time

import httpx
import pytest
from django.test import Client
from ninja.errors import HttpError

from config.external_api_handler import handle_api_call, handle_api_call_graceful
from config.logging import HealthCheckFilter


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    """Neutralise tenacity's exponential backoff so retry tests run instantly."""
    monkeypatch.setattr(time, "sleep", lambda _s: None)


def _request() -> httpx.Request:
    return httpx.Request("GET", "https://api.example.com/x")


def _response(status: int) -> httpx.Response:
    return httpx.Response(status, request=_request(), text="err")


@pytest.mark.unit
def test_timeout_is_retried_then_translated_to_504():
    calls: list[int] = []

    @handle_api_call("svc", max_retries=3)
    def always_times_out():
        calls.append(1)
        raise httpx.ReadTimeout("slow", request=_request())

    with pytest.raises(HttpError) as exc:
        always_times_out()
    assert exc.value.status_code == 504
    assert len(calls) == 3  # retried up to max_retries, then translated


@pytest.mark.unit
def test_connect_error_is_retried_then_translated_to_502():
    calls: list[int] = []

    @handle_api_call("svc", max_retries=3)
    def always_refuses():
        calls.append(1)
        raise httpx.ConnectError("refused", request=_request())

    with pytest.raises(HttpError) as exc:
        always_refuses()
    assert exc.value.status_code == 502  # never leaks a raw httpx exception
    assert len(calls) == 3


@pytest.mark.unit
def test_http_4xx_is_not_retried():
    calls: list[int] = []

    @handle_api_call("svc", max_retries=3)
    def not_found():
        calls.append(1)
        raise httpx.HTTPStatusError("404", request=_request(), response=_response(404))

    with pytest.raises(HttpError) as exc:
        not_found()
    assert exc.value.status_code == 502
    assert len(calls) == 1  # HTTP status errors are permanent — no retry


@pytest.mark.unit
def test_transient_error_recovers_within_retries():
    calls: list[int] = []

    @handle_api_call("svc", max_retries=3)
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
    """422 bodies must not contain the submitted values (e.g. a too-short password)."""
    resp = Client().post(
        "/auth/register",
        data={"username": "eve", "email": "not-an-email", "password": "hunter1"},
        content_type="application/json",
    )
    assert resp.status_code == 422
    body = resp.json()
    assert body["detail"] == "Validation error"
    assert "hunter1" not in resp.content.decode()
    for error in body["errors"]:
        assert set(error) <= {"type", "loc", "msg"}


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
