"""Pytest configuration and shared fixtures."""

from unittest.mock import patch

import pytest

# ==================== Health Check Fixtures ====================


@pytest.fixture
def mock_all_healthy():
    """Mock all health checks to return healthy."""
    with (
        patch("apps.health.views._check_database", return_value=True),
        patch("apps.health.views._check_cache", return_value=True),
        patch("apps.health.views._check_celery", return_value=True),
    ):
        yield


# ==================== Auth Fixtures ====================

PASSWORD = "pw-12345678"


@pytest.fixture
def user(db):
    from django.contrib.auth.models import User

    return User.objects.create_user(username="alice", email="alice@example.com", password=PASSWORD)


@pytest.fixture
def other_user(db):
    from django.contrib.auth.models import User

    return User.objects.create_user(username="bob", email="bob@example.com", password=PASSWORD)


@pytest.fixture
def auth_headers(user):
    """Authorization header for ``user``, ready to splat into a test client call."""
    from apps.accounts.services import AuthService

    return {"Authorization": f"Bearer {AuthService.issue_token(user)}"}


@pytest.fixture
def other_auth_headers(other_user):
    from apps.accounts.services import AuthService

    return {"Authorization": f"Bearer {AuthService.issue_token(other_user)}"}
