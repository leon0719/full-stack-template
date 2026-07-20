from unittest.mock import patch

import pytest
from django.test import AsyncClient


@pytest.mark.unit
class TestRootEndpoint:
    """GET / — public API info only (no health / host details)."""

    def test_root_returns_api_info_only(self, client):
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Django Ninja Project Tree"
        assert data["version"] == "0.1.0"
        # Reconnaissance surface must stay closed to anonymous callers:
        # no commit/environment fingerprinting, no dependency health map.
        assert "commit" not in data
        assert "environment" not in data
        assert "health" not in data


@pytest.mark.unit
class TestLivenessEndpoint:
    """GET /health/live — process-only probe for the Docker HEALTHCHECK."""

    def test_live_ok(self, client):
        response = client.get("/health/live")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    @patch("apps.health.views._check_database", return_value=False)
    def test_live_stays_up_when_db_down(self, mock_db, client):
        # Liveness must not depend on the DB — a blip must not restart the pod.
        response = client.get("/health/live")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


@pytest.mark.unit
class TestReadinessEndpoint:
    """GET /health/ready — gated on request-path deps (DB + cache)."""

    def test_ready_ok(self, client, mock_all_healthy):
        response = client.get("/health/ready")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    @patch("apps.health.views._check_celery", return_value=False)
    @patch("apps.health.views._check_cache", return_value=True)
    @patch("apps.health.views._check_database", return_value=True)
    def test_ready_degraded_but_up_when_celery_down(self, mock_db, mock_cache, mock_celery, client):
        # Celery down → degraded, but the API can still serve → 200, not 503.
        response = client.get("/health/ready")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"
        assert data["celery"] is False

    @patch("apps.health.views._check_celery", return_value=True)
    @patch("apps.health.views._check_cache", return_value=False)
    @patch("apps.health.views._check_database", return_value=True)
    def test_ready_fails_when_cache_down(self, mock_db, mock_cache, mock_celery, client):
        response = client.get("/health/ready")
        assert response.status_code == 503
        data = response.json()
        assert data["status"] == "error"
        assert data["cache"] is False


@pytest.mark.unit
class TestCacheCheck:
    """_check_cache probes the configured cache backend, not a raw Redis URL."""

    def test_cache_check_roundtrips_default_backend(self):
        # local settings use LocMemCache — the probe must exercise exactly that.
        from apps.health.views import _check_cache

        assert _check_cache() is True

    def test_cache_check_false_when_backend_broken(self):
        from apps.health.views import _check_cache

        with patch("apps.health.views.caches", {"default": None}):
            assert _check_cache() is False


@pytest.mark.unit
class TestAsyncHealthEndpoints:
    """Async test examples (pytest-asyncio, asyncio_mode=auto) for the async views.

    ``async def`` tests drive Django's AsyncClient straight through the ASGI
    path — the same code path uvicorn uses — without sync_to_async shims.
    """

    async def test_root_async(self):
        response = await AsyncClient().get("/")
        assert response.status_code == 200
        data = response.json()
        assert data == {"name": "Django Ninja Project Tree", "version": "0.1.0"}

    async def test_ready_ok_async(self, mock_all_healthy):
        response = await AsyncClient().get("/health/ready")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
