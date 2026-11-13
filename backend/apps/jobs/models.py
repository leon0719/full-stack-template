from django.conf import settings
from django.db import models

from apps.core.models import TimestampedModel


class Job(TimestampedModel):
    """使用者發起的長任務(Celery task)的狀態與進度。

    為什麼不用 Celery result backend:這個專案刻意 ``CELERY_TASK_IGNORE_RESULT=True``、沒有 result
    backend;而且「只能查自己發起的 job」需要 task → owner 的對應,本來就得存 DB。用一張表同時
    拿到 owner scoping(IDOR → 404)、可查詢的歷史、與跨 worker 的取消旗標。
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="jobs")
    # Celery task 名稱(@shared_task(name=...)),分辨是哪一種 job。
    kind = models.CharField(max_length=100)
    # 建立時先產生,再以 apply_async(task_id=...) 送出:revoke 與 log 都靠它對回 Celery。
    celery_task_id = models.CharField(max_length=255, unique=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    # 0-100;NULL = 還沒開始或無法估算(前端 useJobPolling 顯示不確定進度)。
    progress = models.PositiveSmallIntegerField(null=True, blank=True)
    message = models.CharField(max_length=255, blank=True)
    result = models.JSONField(null=True, blank=True)
    # 失敗原因的穩定錯誤碼(snake_case,前端可當 i18n key),沒失敗時為空字串(API 回 null)。人看的說明放 message;
    # 未預期例外一律是 "internal_error"(細節只在 log/Sentry,不給使用者看)。
    error = models.CharField(max_length=64, blank=True)
    # 協作式取消旗標:task 每次回報進度時檢查,有值就停下。
    cancel_requested_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    FINISHED = (Status.SUCCEEDED, Status.FAILED, Status.CANCELLED)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["owner", "-created_at"]),
            # 保留期清理(jobs.purge_old_jobs)的查詢路徑。
            models.Index(fields=["finished_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.kind} #{self.pk} ({self.status})"
