from typing import Any, Literal

from ninja import Schema
from pydantic import AwareDatetime, Field

from apps.core.schema import TimestampedSchema


class JobResponse(TimestampedSchema):
    """前五個欄位是與前端 ``shared/api/use-job-polling.ts`` 的 ``Job`` 約定的形狀,不要改名;其餘是附加資訊。"""

    id: int
    status: Literal["pending", "running", "succeeded", "failed", "cancelled"]
    progress: int | None = Field(..., ge=0, le=100, description="0-100;null = 尚未開始或無法估算。")
    result: Any | None = Field(..., description="成功時 task 的回傳值,其餘狀態為 null。")
    error: str | None = Field(..., description="失敗原因的穩定錯誤碼(可當 i18n key);沒有失敗時為 null。")
    kind: str
    message: str
    cancel_requested: bool = Field(..., description="已要求取消、task 尚未在下一個檢查點停下時為 true。")
    started_at: AwareDatetime | None
    finished_at: AwareDatetime | None

    @staticmethod
    def resolve_error(obj: Any) -> str | None:
        return obj.error or None

    @staticmethod
    def resolve_cancel_requested(obj: Any) -> bool:
        return obj.cancel_requested_at is not None


class DemoJobRequest(Schema):
    steps: int = Field(10, ge=1, le=60, description="Number of progress steps.")
    delay_seconds: float = Field(1.0, ge=0, le=5, description="Simulated work per step.")
