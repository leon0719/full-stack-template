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


class RegisterThrottle(AnonRateThrottle):
    """Per-IP limiter for the register endpoint."""

    def __init__(self) -> None:
        super().__init__(settings.THROTTLE_REGISTER_RATE)
