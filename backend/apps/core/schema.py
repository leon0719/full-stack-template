"""Generic, cross-app response schemas."""

from ninja import Schema
from pydantic import AwareDatetime


class DetailResponse(Schema):
    """A bare ``{"detail": "..."}`` message body reused across apps."""

    detail: str


class TimestampedSchema(Schema):
    """Response base carrying the self-managing timestamp fields that mirror
    ``apps.core.models.TimestampedModel``. Resource ``*Response`` schemas inherit it."""

    # AwareDatetime rejects naive datetimes at parse time, so the project's
    # USE_TZ / DTZ convention is self-enforced for every inheriting *Response.
    created_at: AwareDatetime
    updated_at: AwareDatetime
