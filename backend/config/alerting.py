"""背景作業的告警 —— 補上 Sentry 結構上看不到的那一半。

Sentry 只聽得到「跑了而且丟出例外」的程式碼。維運上最痛的幾種故障剛好都不長那樣:

  - celery-beat 掛了 → 排程不再觸發 → 沒有任何例外,只有沉默
  - worker 容器沒起來 → 任務堆積在 queue → 沒有任何一個任務「失敗」
  - 任務重試耗盡 → Sentry 收得到,但混在一般錯誤裡,看不出「已經放棄了」

前兩者的共通點是:**故障的表現形式是「什麼都沒發生」**,而沉默和健康長得一模一樣。
偵測沉默只能靠外部:一個預期會定期收到 ping 的監控服務,ping 沒來就告警。
這就是 BEAT_HEARTBEAT_URL 的用途(healthchecks.io / Better Stack / Cronitor 皆可)。

Slack 通知不在這裡送 —— Sentry 已經是所有錯誤的匯集點,Slack 由 Sentry 的
alert rule 發,避免同一件事兩條路徑各送一份、又各自漏掉一些。設定步驟見
docs/alerting.md。
"""

from __future__ import annotations

from celery.signals import task_failure, task_retry
from django.conf import settings
from loguru import logger

# 心跳與佇列檢查都不該把 beat 拖垮:外部服務慢或掛掉時,寧可放棄這次 ping。
_HEARTBEAT_TIMEOUT_SECONDS = 10


def ping_heartbeat(url: str) -> bool:
    """通知外部監控服務「beat 還活著」。任何失敗都只記錄,不往外拋。

    回傳是否 ping 成功,方便測試與呼叫端記錄。
    """
    if not url:
        return False
    # 延遲 import:httpx 只有這條路徑需要,讓 settings 匯入階段保持輕量。
    import httpx

    try:
        response = httpx.get(url, timeout=_HEARTBEAT_TIMEOUT_SECONDS)
        response.raise_for_status()
    except Exception as exc:  # noqa: BLE001 - 心跳絕不能成為 beat 掛掉的原因
        # 心跳失敗本身就值得知道 —— 但用 warning 而非 exception:監控服務短暫
        # 不可用不代表我們的服務有問題,真正的故障會由「監控服務收不到 ping」
        # 那一端告警。
        logger.warning("[Alerting] heartbeat ping failed - error: {error}", error=repr(exc))
        return False
    logger.debug("[Alerting] heartbeat ping ok")
    return True


@task_failure.connect
def _on_task_failure(
    sender: object = None,
    task_id: str | None = None,
    exception: BaseException | None = None,
    **_kwargs: object,
) -> None:
    """任務最終失敗(含重試耗盡)時留下結構化紀錄。

    CeleryIntegration 已經會把例外送進 Sentry,這裡不重複送,只補一條帶
    task 名稱與 id 的 ERROR log —— 讓「用 log 做告警」的人(Loki/CloudWatch
    metric filter)不必去解析 traceback 就能建規則,也讓 Sentry 事件能用
    task_id 對回日誌。
    """
    task_name = getattr(sender, "name", None) or repr(sender)
    logger.error(
        "[Task] failed permanently - task: {task}, task_id: {task_id}, error: {error}",
        task=task_name,
        task_id=task_id,
        error=repr(exception),
    )


@task_retry.connect
def _on_task_retry(
    sender: object = None,
    request: object = None,
    reason: object = None,
    **_kwargs: object,
) -> None:
    """重試是「還沒失敗」,用 warning 記錄即可,不進 Sentry。

    有這條的價值在於:任務反覆重試最後成功時,Sentry 完全不會有紀錄,
    但它往往是外部依賴正在劣化的第一個徵兆。
    """
    task_name = getattr(sender, "name", None) or repr(sender)
    logger.warning(
        "[Task] retrying - task: {task}, task_id: {task_id}, reason: {reason}",
        task=task_name,
        task_id=getattr(request, "id", None),
        reason=repr(reason),
    )


def get_queue_depth() -> int | None:
    """回傳 Celery 預設佇列的待處理訊息數;取不到時回傳 None。

    直接問 broker(Redis 的 LLEN)而不用 celery inspect —— inspect 是問「worker」,
    但 worker 全掛的時候正是最需要這個數字的時刻,那時 inspect 什麼也問不到。
    """
    from kombu import Connection

    queue_name = getattr(settings, "CELERY_TASK_DEFAULT_QUEUE", "celery")
    try:
        with Connection(settings.CELERY_BROKER_URL) as conn:
            channel = conn.default_channel
            # kombu 的 Redis/AMQP channel 都提供 _size();介面非公開但穩定,
            # 且是唯一不需要 worker 在線就能取得佇列長度的方法。
            return int(channel._size(queue_name))
    except Exception as exc:  # noqa: BLE001 - 量測失敗回 None,不能影響呼叫端
        logger.warning("[Alerting] queue depth check failed - error: {error}", error=repr(exc))
        return None
