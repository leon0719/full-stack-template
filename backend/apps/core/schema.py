"""Generic, cross-app response schemas."""

from ninja import Schema
from pydantic import AwareDatetime, ConfigDict

# Response schemas: fields with a default (``= None``) are still always present in the
# JSON, so mark them required in the OpenAPI *response* schema. Otherwise the generated
# frontend types (``make gen-api`` / openapi-typescript) turn them into optional ``?`` keys.
_ALWAYS_PRESENT = ConfigDict(json_schema_serialization_defaults_required=True)


class ErrorResponse(Schema):
    """Error info inside ``BaseResponse``. ``code`` is the HTTP status (team contract);
    ``reason`` is the stable machine-readable ``ErrorCode`` (``config/errors.py``), or
    ``None`` for errors raised as a plain ``HttpError``."""

    model_config = _ALWAYS_PRESENT

    code: int
    message: str
    reason: str | None = None


class BaseResponse[T](Schema):
    """Team-wide response envelope, shared with the FastAPI/.NET backends:

    success ``{"data": <T>, "error": null}``
    failure ``{"data": null, "error": {"code": <HTTP status>, "message": "...", "reason": "..."}}``

    Every ``/api`` endpoint declares ``response=BaseResponse[XxxResponse]`` and returns
    ``BaseResponse(data=...)``. Errors are never built here — raise and let
    ``config/exceptions.py`` render them.
    """

    model_config = _ALWAYS_PRESENT

    data: T | None = None
    error: ErrorResponse | None = None


class Page[T](Schema):
    """Page-number pagination payload (``StandardPagination``)."""

    items: list[T]
    count: int


class TimestampedSchema(Schema):
    """Response base carrying the self-managing timestamp fields that mirror
    ``apps.core.models.TimestampedModel``. Resource ``*Response`` schemas inherit it."""

    # AwareDatetime rejects naive datetimes at parse time, so the project's
    # USE_TZ / DTZ convention is self-enforced for every inheriting *Response.
    created_at: AwareDatetime
    updated_at: AwareDatetime
