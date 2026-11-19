"""Semantic throttle classes. Rates are sourced from Django settings (which in turn
come from the Pydantic ``Settings`` class), so views reference a name, never an
inline rate string.

Each class sets its own ``scope``: ninja keys the cache as ``throttle_<scope>_<ident>``,
so sharing the inherited "anon"/"auth" scope would make endpoints drain one bucket.
``rate_setting`` is read at instantiation (request time), so ``override_settings``
in tests takes effect.
"""

from django.conf import settings
from ninja.throttling import AnonRateThrottle, AuthRateThrottle


class _SettingsRateMixin:
    rate_setting: str

    def __init__(self) -> None:
        super().__init__(getattr(settings, self.rate_setting))  # type: ignore[call-arg]


class WriteRateThrottle(_SettingsRateMixin, AuthRateThrottle):
    """Per-user write limiter, shared across every write endpoint on purpose — one
    budget per user. Keep it off endpoints a locked-out user still needs, e.g.
    logout (revoking your own tokens)."""

    scope = "write"
    rate_setting = "THROTTLE_WRITE_RATE"


class LoginThrottle(_SettingsRateMixin, AnonRateThrottle):
    """Per-IP limiter for the LINE login exchange endpoint."""

    scope = "login"
    rate_setting = "THROTTLE_LOGIN_RATE"


class ExportThrottle(_SettingsRateMixin, AuthRateThrottle):
    """Per-user limiter for synchronous file exports (each one builds the whole file in memory)."""

    scope = "export"
    rate_setting = "THROTTLE_EXPORT_RATE"
