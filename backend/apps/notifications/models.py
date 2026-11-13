import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import TimestampedModel


class Notification(TimestampedModel):
    """通知 outbox:每一則要送出的通知先寫成一筆,再由 Celery 發送、beat 補送。

    狀態由時間欄位推導(不另存 status,避免兩個來源不一致):
    - pending:``sent_at`` 與 ``abandoned_at`` 皆為 NULL
    - sent:``sent_at`` 有值
    - abandoned:``abandoned_at`` 有值(重試 ``NOTIFICATION_MAX_RETRIES`` 次仍失敗,已告警)
    """

    class Channel(models.TextChoices):
        EMAIL = "email", "Email"
        LINE = "line", "LINE"

    channel = models.CharField(max_length=20, choices=Channel.choices)
    # Email 地址或 LINE userId / groupId。
    recipient = models.CharField(max_length=254)
    # email: {"subject", "body", "html_body"?};line: {"messages": [<LINE message object>, ...]}
    payload = models.JSONField()
    # 選填:這則通知屬於哪個使用者(查「我的通知」、刪帳號時保留紀錄但斷開關聯)。
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="notifications",
    )
    # 觸發來源(例如 "articles.published:42"),排查「這則通知從哪來」用。
    source = models.CharField(max_length=100, blank=True)
    # 同一則通知每次重送都帶同一把 key:LINE 用它當 X-Line-Retry-Key(重複送出會回 409,
    # 不會真的發兩次);其他 channel 的消費端也可以拿它去重。
    idempotency_key = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    retry_count = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True)
    # 發送中的認領期限:送出前以 rows-affected UPDATE 認領,避免「立即發送」與「beat 補送」
    # 同時送同一則。worker 中途死掉時期限過了會自動釋放,由下一輪 beat 補送。
    locked_until = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    abandoned_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            # beat 補送的查詢路徑:只索引 pending 的列,送出後自動離開索引,大小只跟積壓量有關。
            models.Index(
                fields=["created_at"],
                name="notification_pending_idx",
                condition=Q(sent_at__isnull=True, abandoned_at__isnull=True),
            ),
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.channel} → {self.recipient} (#{self.pk})"
