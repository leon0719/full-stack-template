"""維運用的週期性任務:心跳與佇列深度。

這兩支的共同點是它們**不服務任何業務功能** —— 存在的唯一目的是讓「服務悄悄
壞掉」變成可偵測的事件。詳見 config/alerting.py 的說明。
"""

from celery import shared_task
from django.conf import settings
from loguru import logger

from config.alerting import get_queue_depth, ping_heartbeat


@shared_task(name="core.beat_heartbeat")
def beat_heartbeat() -> str:
    """向外部監控服務回報 beat 仍在運作。

    這支任務「成功執行」本身就是訊號 —— 它沒跑,監控端就收不到 ping 而告警。
    因此絕不能讓它丟出例外:例外會讓 Celery 記成任務失敗,但外部監控要的是
    「有沒有收到 ping」,兩者是不同的訊號。
    """
    url = settings.BEAT_HEARTBEAT_URL
    if not url:
        return "disabled"
    return "ok" if ping_heartbeat(url) else "ping-failed"


@shared_task(name="core.check_queue_depth")
def check_queue_depth() -> str:
    """佇列積壓超過門檻時送一則 Sentry 訊息。

    積壓的特徵是「沒有任何一個任務失敗」—— 每個任務都好好地排著隊,只是永遠
    輪不到。除非主動量測,否則不會有任何錯誤訊號。
    """
    threshold = settings.CELERY_QUEUE_DEPTH_ALERT_THRESHOLD
    if not threshold:
        return "disabled"

    depth = get_queue_depth()
    if depth is None:
        return "unknown"

    if depth > threshold:
        logger.error(
            "[Alerting] celery queue backlog - depth: {depth}, threshold: {threshold}",
            depth=depth,
            threshold=threshold,
        )
        # 用 capture_message 而非丟例外:積壓不是這支任務的錯誤,丟例外會讓它
        # 自己被重試,反而在已經塞住的佇列上再加一筆。
        import sentry_sdk

        sentry_sdk.capture_message(
            f"Celery queue backlog: {depth} messages (threshold {threshold})",
            level="error",
        )
        return "alerted"

    logger.debug("[Alerting] queue depth ok - depth: {depth}", depth=depth)
    return "ok"
