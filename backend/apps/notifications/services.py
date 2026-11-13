"""通知 outbox:寫入 → Celery 發送 → 失敗記錄重試 → 超過次數放棄並告警。

業務程式只呼叫 ``NotificationService.enqueue_email`` / ``enqueue_line``。在業務寫入的
``transaction.atomic()`` 內呼叫時,outbox 列跟業務資料同一個交易 commit(transactional outbox):
業務回滾,通知也不會送;業務成功,通知一定留在表裡(broker 當下不通也不會掉,beat 會補送)。

投遞語意是 at-least-once:送出後、標記 sent 之前 worker 死掉,下一輪會再送一次。LINE 靠
``X-Line-Retry-Key`` 去重;email 無法去重,接受極少數重複。
"""

import smtplib
from datetime import timedelta
from typing import Any

import orjson
from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.db.models import Q, QuerySet
from django.utils import timezone
from loguru import logger
from ninja.errors import HttpError

from apps.notifications.external_services import line_configured, push_line_message
from apps.notifications.models import Notification
from apps.notifications.utils import email_subject, verify_line_signature
from config.alerting import alert
from config.errors import AppError, ErrorCode

# 認領期限:要大於單次發送最久可能花的時間(SMTP timeout / LINE 的 tenacity 重試 ≤ 30s)。
CLAIM_SECONDS = 300
# beat 只補送建立超過這麼久的通知,不跟「建立當下的立即發送」搶。
RETRY_GRACE = timedelta(minutes=1)
RETRY_BATCH_SIZE = 200
# LINE push 單次最多 5 則訊息、每則 text 最多 5000 字。
LINE_MAX_MESSAGES = 5
LINE_MAX_TEXT = 5000


def _pending() -> QuerySet[Notification]:
    return Notification.objects.filter(sent_at__isnull=True, abandoned_at__isnull=True)


class NotificationService:
    # ------------------------------------------------------------------ enqueue
    @staticmethod
    def enqueue_email(
        to: str,
        subject: str,
        body: str,
        *,
        html_body: str = "",
        user: AbstractBaseUser | None = None,
        source: str = "",
    ) -> Notification:
        payload = {"subject": subject, "body": body}
        if html_body:
            payload["html_body"] = html_body
        return NotificationService._enqueue(Notification.Channel.EMAIL, to, payload, user=user, source=source)

    @staticmethod
    def enqueue_line(
        to: str, texts: str | list[str], *, user: AbstractBaseUser | None = None, source: str = ""
    ) -> Notification:
        """``to`` = LINE userId / groupId。``texts`` 一則或最多 5 則文字訊息。"""
        items = [texts] if isinstance(texts, str) else list(texts)
        if not 1 <= len(items) <= LINE_MAX_MESSAGES or any(not t or len(t) > LINE_MAX_TEXT for t in items):
            raise ValueError(f"LINE push takes 1-{LINE_MAX_MESSAGES} non-empty texts of <= {LINE_MAX_TEXT} chars")
        payload = {"messages": [{"type": "text", "text": t} for t in items]}
        return NotificationService._enqueue(Notification.Channel.LINE, to, payload, user=user, source=source)

    @staticmethod
    def enqueue_line_to_user(
        user: AbstractBaseUser, texts: str | list[str], *, source: str = ""
    ) -> Notification | None:
        """推播給某個使用者:從 ``LineProfile`` 取 LINE Login 存下的 userId。

        沒有 ``LineProfile`` 的使用者(例如 ``createsuperuser`` 建的管理員)回 None、不建 outbox 列。
        前提:LINE Login channel 與 Messaging API channel 在 LINE Developers Console 的「同一個
        provider」底下——userId 是 per-provider 的,不同 provider 拿到的 userId 推不到同一個人。
        使用者還必須已加官方帳號(Messaging channel 的 bot)為好友,否則 LINE 會拒絕、重試耗盡後告警。
        """
        from apps.accounts.models import LineProfile

        line_user_id = LineProfile.objects.filter(user_id=user.pk).values_list("line_user_id", flat=True).first()
        if not line_user_id:
            logger.warning("[Service] LINE push skipped - user has no LINE profile, user_id: {uid}", uid=user.pk)
            return None
        return NotificationService.enqueue_line(line_user_id, texts, user=user, source=source)

    @staticmethod
    def _enqueue(
        channel: str, recipient: str, payload: dict[str, Any], *, user: AbstractBaseUser | None, source: str
    ) -> Notification:
        from apps.notifications.tasks import send_notification

        notification = Notification.objects.create(
            channel=channel, recipient=recipient, payload=payload, user_id=user.pk if user else None, source=source
        )
        # on_commit:worker 不會在 commit 前就撈不到這列;robust=True:broker 不通只記 log,
        # 不讓業務請求 500——列已經在表裡,beat 的補送會接手。
        transaction.on_commit(lambda: send_notification.delay(notification.pk), robust=True)
        logger.info(
            "[Service] notification enqueued - id: {id}, channel: {c}, source: {s}",
            id=notification.pk,
            c=channel,
            s=source,
        )
        return notification

    # ------------------------------------------------------------------ deliver
    @staticmethod
    def claim(notification_id: int) -> Notification | None:
        """原子認領一則 pending 通知(rows-affected UPDATE),回傳 None 代表已送出/已放棄/別人正在送。"""
        now = timezone.now()
        claimed = (
            _pending()
            .filter(pk=notification_id)
            .filter(Q(locked_until__isnull=True) | Q(locked_until__lt=now))
            .update(locked_until=now + timedelta(seconds=CLAIM_SECONDS))
        )
        return Notification.objects.get(pk=notification_id) if claimed else None

    @staticmethod
    def deliver(notification_id: int) -> str:
        """發送一則通知並記錄結果。回傳 ``sent`` / ``failed`` / ``abandoned`` / ``skipped``。冪等。"""
        notification = NotificationService.claim(notification_id)
        if notification is None:
            return "skipped"
        if notification.channel == Notification.Channel.EMAIL:
            error = NotificationService._send_email(notification)
        elif notification.channel == Notification.Channel.LINE:
            error = NotificationService._send_line(notification)
        else:
            error = f"unknown channel: {notification.channel}"
        if error is None:
            NotificationService._mark_sent(notification)
            return "sent"
        return NotificationService._mark_failed(notification, error)

    @staticmethod
    def _send_email(notification: Notification) -> str | None:
        payload = notification.payload
        message = EmailMultiAlternatives(
            subject=email_subject(payload["subject"], settings.ENV),
            body=payload["body"],
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[notification.recipient],
            # 收件端可用這個 header 去重(at-least-once 偶爾會重送)。
            headers={"X-Notification-Id": str(notification.idempotency_key)},
        )
        if payload.get("html_body"):
            message.attach_alternative(payload["html_body"], "text/html")
        try:
            message.send()
        except (smtplib.SMTPException, OSError) as exc:  # OSError 涵蓋連線拒絕/逾時/DNS
            return f"{type(exc).__name__}: {exc}"
        return None

    @staticmethod
    def _send_line(notification: Notification) -> str | None:
        if not line_configured():
            # 跟 email 的 LogOnlyEmailBackend 同一個取捨:沒設定就只記 log、視為已處理,
            # 開發環境不會因為沒有 token 而累積重試、觸發告警。
            logger.warning("[Service] LINE not configured (LINE_MESSAGING_CHANNEL_ACCESS_TOKEN empty), push NOT sent")
            return None
        result = push_line_message(
            notification.recipient, notification.payload["messages"], retry_key=str(notification.idempotency_key)
        )
        return None if result.ok else result.error

    @staticmethod
    def _mark_sent(notification: Notification) -> None:
        notification.sent_at = timezone.now()
        notification.locked_until = None
        notification.last_error = ""
        notification.save(update_fields=["sent_at", "locked_until", "last_error", "updated_at"])
        logger.info("[Service] notification sent - id: {id}", id=notification.pk)

    @staticmethod
    def _mark_failed(notification: Notification, error: str) -> str:
        notification.retry_count += 1
        notification.last_error = error[:2000]
        notification.locked_until = None
        fields = ["retry_count", "last_error", "locked_until", "updated_at"]
        abandoned = notification.retry_count >= settings.NOTIFICATION_MAX_RETRIES
        if abandoned:
            notification.abandoned_at = timezone.now()
            fields.append("abandoned_at")
        notification.save(update_fields=fields)
        if abandoned:
            alert(
                "Notification abandoned after max retries",
                notification_id=notification.pk,
                channel=notification.channel,
                source=notification.source,
                retries=notification.retry_count,
                last_error=notification.last_error,
            )
            return "abandoned"
        logger.warning(
            "[Service] notification failed - id: {id}, attempt: {n}, error: {e}",
            id=notification.pk,
            n=notification.retry_count,
            e=notification.last_error,
        )
        return "failed"

    # ------------------------------------------------------------------ beat
    @staticmethod
    def due_for_retry_ids() -> list[int]:
        now = timezone.now()
        return list(
            _pending()
            .filter(created_at__lt=now - RETRY_GRACE)
            .filter(Q(locked_until__isnull=True) | Q(locked_until__lt=now))
            .order_by("created_at")
            .values_list("pk", flat=True)[:RETRY_BATCH_SIZE]
        )

    @staticmethod
    def retry(notification_id: int) -> None:
        """後台手動「再試一次」:清掉放棄狀態與次數,重新排入。"""
        from apps.notifications.tasks import send_notification

        Notification.objects.filter(pk=notification_id, sent_at__isnull=True).update(
            abandoned_at=None, retry_count=0, locked_until=None
        )
        transaction.on_commit(lambda: send_notification.delay(notification_id), robust=True)

    @staticmethod
    def purge_old() -> int:
        days = settings.NOTIFICATION_RETENTION_DAYS
        if days == 0:
            return 0
        cutoff = timezone.now() - timedelta(days=days)
        # 只清「已結束」的(sent / abandoned);pending 的不管多舊都留著,那是要追的問題。
        deleted, _ = Notification.objects.filter(Q(sent_at__lt=cutoff) | Q(abandoned_at__lt=cutoff)).delete()
        return deleted

    @staticmethod
    def failed_qs() -> QuerySet[Notification]:
        """尚未成功送出的通知(重試中 + 已放棄),新到舊。給管理端查看。"""
        return Notification.objects.filter(sent_at__isnull=True).select_related("user")


class LineWebhookService:
    @staticmethod
    def handle(body: bytes, signature: str) -> int:
        """驗簽並處理 LINE 送來的 webhook,回傳事件數。

        驗簽失敗一律 401,不透露原因;secret 沒設定時 503(無法驗簽就不能接受任何請求)。
        """
        secret = settings.LINE_MESSAGING_CHANNEL_SECRET
        if not secret:
            logger.warning("[Service] LINE webhook rejected - LINE_MESSAGING_CHANNEL_SECRET not configured")
            raise HttpError(503, "LINE webhook is not configured")
        if not verify_line_signature(body, signature, secret):
            logger.warning("[Service] LINE webhook rejected - invalid signature")
            raise AppError(401, ErrorCode.INVALID_SIGNATURE, "Invalid signature")
        try:
            data = orjson.loads(body)
        except orjson.JSONDecodeError as exc:
            raise AppError(400, ErrorCode.BAD_REQUEST, "Invalid JSON body") from exc
        events = data.get("events", []) if isinstance(data, dict) else []
        for event in events:
            # 在這裡依 event["type"](message / follow / unfollow / postback …)分派到業務邏輯。
            # 不要把整個 body 寫進 log:裡面有使用者的 userId 與訊息內容(個資)。
            # LINE 會在 1 秒左右沒收到 200 就重送,耗時的處理請丟 Celery task。
            logger.info(
                "[Service] LINE webhook event - type: {t}", t=event.get("type") if isinstance(event, dict) else "?"
            )
        return len(events)
