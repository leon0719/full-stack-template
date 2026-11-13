"""LINE Messaging API(push message)。本專案唯一能用 httpx 的層。

呼叫端(outbox 發送)需要知道成功與否與錯誤原因才能記錄重試,所以這裡不 ``raise_for_status``:
HTTP 錯誤轉成 ``LinePushResult(ok=False, error=...)`` 回傳;只有逾時/連線錯誤會被
``@handle_api_call_graceful`` 重試,重試耗盡後降級成 ``_TRANSPORT_FAILURE``。
"""

from dataclasses import dataclass
from typing import Any

import httpx
from django.conf import settings
from loguru import logger

from config.external_api_handler import handle_api_call_graceful

LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"
_LINE_TIMEOUT_SECONDS = 10.0
_ERROR_BODY_CHARS = 300


@dataclass(frozen=True)
class LinePushResult:
    ok: bool
    error: str = ""


_TRANSPORT_FAILURE = LinePushResult(ok=False, error="LINE API unreachable (timeout/connection error after retries)")


def line_configured() -> bool:
    return bool(settings.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN)


@handle_api_call_graceful("line-push", default_return=_TRANSPORT_FAILURE)
def push_line_message(to: str, messages: list[dict[str, Any]], *, retry_key: str) -> LinePushResult:
    """送一則 push message。``retry_key`` 每則通知固定(outbox 的 idempotency_key):

    LINE 收到同一把 ``X-Line-Retry-Key`` 的重送會回 409 而不再發送——代表先前那次其實成功了
    (例如回應在路上逾時),所以 409 視為成功。
    """
    response = httpx.post(
        LINE_PUSH_URL,
        json={"to": to, "messages": messages},
        headers={
            "Authorization": f"Bearer {settings.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN}",
            "X-Line-Retry-Key": retry_key,
        },
        timeout=_LINE_TIMEOUT_SECONDS,
    )
    if response.is_success or response.status_code == httpx.codes.CONFLICT:
        logger.info("[External] LINE push accepted - status: {s}", s=response.status_code)
        return LinePushResult(ok=True)
    # 429 = 當月配額用完(或打太快);4xx 其他多半是 userId 錯、對方沒加好友、訊息格式錯。
    logger.warning("[External] LINE push rejected - status: {s}", s=response.status_code)
    return LinePushResult(ok=False, error=f"HTTP {response.status_code}: {response.text[:_ERROR_BODY_CHARS]}")
