"""Domain error type carrying a stable, machine-readable code.

Plain ``HttpError(status, message)`` leaves clients no way to branch on an
error other than string-matching ``detail``, which breaks the moment the
message copy changes. Services should raise ``AppError`` instead whenever the
error is something a client might reasonably want to handle programmatically
(e.g. show a specific field error vs. a generic failure banner).
"""

from enum import StrEnum

from ninja.errors import HttpError


class ErrorCode(StrEnum):
    """Central registry of stable error codes returned in API error responses.

    Add new codes here rather than passing ad-hoc strings to ``AppError`` (or
    hardcoding them in ``config/exceptions.py``) — an inline string typo or
    duplicate is invisible to mypy/CI, an enum member typo isn't.
    """

    INVALID_EXCHANGE_CODE = "invalid_exchange_code"
    UNAUTHENTICATED = "unauthenticated"
    PERMISSION_DENIED = "permission_denied"
    NOT_FOUND = "not_found"
    RATE_LIMITED = "rate_limited"
    PAYLOAD_TOO_LARGE = "payload_too_large"
    VALIDATION_ERROR = "validation_error"
    INTERNAL_ERROR = "internal_error"
    BAD_REQUEST = "bad_request"


class AppError(HttpError):
    def __init__(self, status_code: int, code: ErrorCode, message: str) -> None:
        self.code = code
        super().__init__(status_code, message)
