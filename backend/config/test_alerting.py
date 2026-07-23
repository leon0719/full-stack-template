"""Tests for the alerting layer: prod Sentry enforcement, heartbeat, queue depth.

這些行為的共同點是「平常不會有人注意到它壞了」—— 心跳沒送出、佇列檢查靜默失敗,
表現都跟正常運作一樣。所以它們特別需要測試釘住。
"""

import httpx
import pytest
from pydantic import SecretStr, ValidationError

from config.alerting import get_queue_depth, ping_heartbeat
from config.settings.base import SENTRY_DSN_OPT_OUT, Settings

pytestmark = pytest.mark.unit


def _prod_kwargs(**overrides):
    """一組能通過 prod 驗證的最小設定,再由各測試覆寫單一欄位。"""
    base = {
        "ENV": "prod",
        "SECRET_KEY": "x" * 60,
        "DATABASE_URL": "postgresql://u:p@db:5432/n",
        "ALLOWED_HOSTS": "api.example.com",
        "CORS_ALLOWED_ORIGINS": "https://app.example.com",
        "CELERY_BROKER_URL": "redis://real-broker:6379/0",
        "CACHE_URL": "redis://real-cache:6379/1",
        "SENTRY_DSN": "https://public@o0.ingest.sentry.io/1",
    }
    return {**base, **overrides}


class TestProdRequiresSentry:
    def test_missing_dsn_blocks_prod_startup(self):
        with pytest.raises(ValidationError, match="SENTRY_DSN"):
            Settings(**_prod_kwargs(SENTRY_DSN=""))

    def test_whitespace_only_dsn_is_treated_as_missing(self):
        with pytest.raises(ValidationError, match="SENTRY_DSN"):
            Settings(**_prod_kwargs(SENTRY_DSN="   "))

    def test_explicit_opt_out_is_accepted(self):
        """明確選擇不用 Sentry 是允許的 —— 重點是「不能是忘記設」。"""
        cfg = Settings(**_prod_kwargs(SENTRY_DSN=SENTRY_DSN_OPT_OUT))
        assert cfg.SENTRY_DSN.get_secret_value() == SENTRY_DSN_OPT_OUT

    def test_real_dsn_is_accepted(self):
        assert Settings(**_prod_kwargs()).ENV == "prod"

    def test_local_env_does_not_require_dsn(self):
        """本地開發不該被強迫接 Sentry。"""
        cfg = Settings(
            ENV="local",
            SECRET_KEY=SecretStr("short-is-fine"),
            DATABASE_URL=SecretStr("sqlite://:memory:"),
        )
        assert cfg.SENTRY_DSN.get_secret_value() == ""


class TestHeartbeat:
    def test_empty_url_is_a_no_op(self):
        assert ping_heartbeat("") is False

    def test_successful_ping(self, monkeypatch):
        called: list[str] = []

        def _get(url, **_kwargs):
            called.append(url)
            return httpx.Response(200, request=httpx.Request("GET", url))

        monkeypatch.setattr(httpx, "get", _get)
        assert ping_heartbeat("https://hc.example.com/abc") is True
        assert called == ["https://hc.example.com/abc"]

    def test_network_failure_never_propagates(self, monkeypatch):
        """心跳失敗不能讓 beat 掛掉 —— 這正是整個機制存在的前提。"""

        def _boom(url, **_kwargs):
            raise httpx.ConnectError("down", request=httpx.Request("GET", url))

        monkeypatch.setattr(httpx, "get", _boom)
        assert ping_heartbeat("https://hc.example.com/abc") is False

    def test_http_error_status_is_a_failure(self, monkeypatch):
        def _get(url, **_kwargs):
            return httpx.Response(500, request=httpx.Request("GET", url))

        monkeypatch.setattr(httpx, "get", _get)
        assert ping_heartbeat("https://hc.example.com/abc") is False


class TestQueueDepth:
    def test_broker_unreachable_returns_none_instead_of_raising(self, settings):
        """量測失敗要能和「佇列是空的」區分開來 —— 前者回 None,後者回 0。"""
        settings.CELERY_BROKER_URL = "redis://nonexistent-host-for-test:6379/0"
        assert get_queue_depth() is None


class TestScheduledTasks:
    """排程任務本身:未設定時要安靜退出,超標時要送出告警。"""

    def test_heartbeat_task_disabled_without_url(self, settings):
        from apps.core.tasks import beat_heartbeat

        settings.BEAT_HEARTBEAT_URL = ""
        assert beat_heartbeat() == "disabled"

    def test_queue_depth_task_disabled_with_zero_threshold(self, settings):
        from apps.core.tasks import check_queue_depth

        settings.CELERY_QUEUE_DEPTH_ALERT_THRESHOLD = 0
        assert check_queue_depth() == "disabled"

    def test_queue_depth_task_alerts_above_threshold(self, settings, monkeypatch):
        import sentry_sdk

        from apps.core import tasks

        settings.CELERY_QUEUE_DEPTH_ALERT_THRESHOLD = 10
        monkeypatch.setattr(tasks, "get_queue_depth", lambda: 99)
        captured: list[tuple[str, str]] = []
        monkeypatch.setattr(sentry_sdk, "capture_message", lambda msg, level="info": captured.append((msg, level)))

        assert tasks.check_queue_depth() == "alerted"
        assert len(captured) == 1
        assert "99" in captured[0][0] and captured[0][1] == "error"

    def test_queue_depth_task_quiet_below_threshold(self, settings, monkeypatch):
        from apps.core import tasks

        settings.CELERY_QUEUE_DEPTH_ALERT_THRESHOLD = 100
        monkeypatch.setattr(tasks, "get_queue_depth", lambda: 5)
        assert tasks.check_queue_depth() == "ok"

    def test_queue_depth_task_reports_unknown_when_measurement_fails(self, settings, monkeypatch):
        """量測不到時不能誤報成「正常」。"""
        from apps.core import tasks

        settings.CELERY_QUEUE_DEPTH_ALERT_THRESHOLD = 10
        monkeypatch.setattr(tasks, "get_queue_depth", lambda: None)
        assert tasks.check_queue_depth() == "unknown"
