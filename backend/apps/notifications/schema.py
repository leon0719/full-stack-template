from pydantic import AwareDatetime, Field

from apps.core.schema import TimestampedSchema


class NotificationResponse(TimestampedSchema):
    id: int
    channel: str
    recipient: str
    source: str
    retry_count: int
    last_error: str
    sent_at: AwareDatetime | None
    abandoned_at: AwareDatetime | None = Field(..., description="有值 = 重試次數用完已放棄(已觸發告警)。")
