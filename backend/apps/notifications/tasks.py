from celery import shared_task
from loguru import logger

from apps.notifications.services import NotificationService


# 不設 autoretry_for:失敗由 outbox 自己記錄(retry_count / last_error),補送交給 beat 的
# retry_pending_notifications;Celery 層再重試會讓次數相乘、而且繞過「超過次數就放棄並告警」。
@shared_task(name="notifications.send_notification")
def send_notification(notification_id: int) -> str:
    """發送一則 outbox 通知。冪等:已送出/已放棄/正被別的 worker 認領的會直接 skip。"""
    return NotificationService.deliver(notification_id)


@shared_task(name="notifications.retry_pending_notifications")
def retry_pending_notifications() -> int:
    """beat 定期補送:broker 當下不通沒排進去的、上次發送失敗的、worker 送到一半死掉的。"""
    ids = NotificationService.due_for_retry_ids()
    for notification_id in ids:
        send_notification.delay(notification_id)
    if ids:
        logger.info("[Task] re-enqueued {n} pending notifications", n=len(ids))
    return len(ids)


@shared_task(name="notifications.purge_old_notifications")
def purge_old_notifications() -> int:
    deleted = NotificationService.purge_old()
    logger.info("[Task] purged {n} finished notifications", n=deleted)
    return deleted
