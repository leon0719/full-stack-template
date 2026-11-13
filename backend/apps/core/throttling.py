"""Semantic throttle classes. Rates are sourced from Django settings (which in turn
come from the Pydantic ``Settings`` class), so views reference a name, never an
inline rate string."""

from django.conf import settings
from ninja.throttling import AnonRateThrottle, AuthRateThrottle


class WriteRateThrottle(AuthRateThrottle):
    """Per-user write limiter for authenticated mutating endpoints."""

    def __init__(self) -> None:
        super().__init__(settings.THROTTLE_WRITE_RATE)


class LoginThrottle(AnonRateThrottle):
    """Per-IP limiter for the login endpoint."""

    def __init__(self) -> None:
        super().__init__(settings.THROTTLE_LOGIN_RATE)


class ExportThrottle(AuthRateThrottle):
    """Per-user limiter for synchronous file exports (each one builds the whole file in memory)."""

    # Own cache scope, so exports don't eat the WriteRateThrottle budget (both default to "user").
    scope = "export"

    def __init__(self) -> None:
        super().__init__(settings.THROTTLE_EXPORT_RATE)
