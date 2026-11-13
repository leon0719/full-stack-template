"""長任務:建立 → Celery 執行(回報進度、檢查取消旗標)→ 結束;發起者查詢/取消。

Task 端怎麼寫見 ``apps/jobs/tasks.py`` 的 ``tracked_job`` 與 ``demo_countdown``。
"""

import uuid
from datetime import timedelta
from typing import Any

from celery import Task
from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from kombu.exceptions import OperationalError as BrokerError
from loguru import logger

from apps.core.services import OwnedResourceService
from apps.jobs.models import Job
from config.errors import AppError, ErrorCode

# Job.error 的錯誤碼(task 自訂的碼用 JobFailed(code) 帶出)。
JOB_ERROR_INTERNAL = "internal_error"
JOB_ERROR_ENQUEUE_FAILED = "enqueue_failed"


class JobCancelled(Exception):  # noqa: N818 — 不是錯誤,是「已取消」的控制流訊號
    """task 在檢查點發現取消旗標時丟出,由 ``tracked_job`` 轉成 cancelled 狀態。"""


class JobFailed(Exception):  # noqa: N818 — 與 JobCancelled 對稱的控制流訊號
    """task 主動回報「使用者可以處理」的失敗(例如上傳的檔案格式不對)。

    ``code`` 存進 ``Job.error``(穩定錯誤碼,前端當 i18n key),``message`` 存進 ``Job.message``。
    """

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code
        self.message = message


class JobService(OwnedResourceService[Job]):
    model = Job

    @classmethod
    def start(cls, user: AbstractBaseUser, task: Task, **task_kwargs: Any) -> Job:
        """建立 job 並在 commit 後送進 Celery。``task_kwargs`` 必須是可 JSON 序列化的 primitive。"""
        job = Job.objects.create(owner_id=user.pk, kind=task.name, celery_task_id=str(uuid.uuid4()))
        transaction.on_commit(lambda: cls._enqueue(job.pk, job.celery_task_id, task, task_kwargs))
        logger.info("[Service] job created - id: {id}, kind: {k}, owner: {uid}", id=job.pk, k=job.kind, uid=user.pk)
        return job

    @staticmethod
    def _enqueue(job_id: int, task_id: str, task: Task, task_kwargs: dict[str, Any]) -> None:
        try:
            task.apply_async(kwargs={"job_id": job_id, **task_kwargs}, task_id=task_id)
        except BrokerError:
            # broker 不通:job 已 commit,標成 failed 讓發起者看得到,而不是永遠 pending。
            logger.error("[Service] job enqueue failed - id: {id}", id=job_id)
            Job.objects.filter(pk=job_id, status=Job.Status.PENDING).update(
                status=Job.Status.FAILED,
                error=JOB_ERROR_ENQUEUE_FAILED,
                message="Could not be queued, please retry",
                finished_at=timezone.now(),
                updated_at=timezone.now(),
            )

    @classmethod
    def cancel_owned(cls, user: AbstractBaseUser, job_id: int) -> Job:
        """取消自己的 job:pending 直接變 cancelled;running 設取消旗標,等 task 在下一個檢查點停下。"""
        job = cls.get_owned_or_404(user, job_id)  # IDOR → 404
        now = timezone.now()
        cancelled = Job.objects.filter(pk=job.pk, status=Job.Status.PENDING).update(
            status=Job.Status.CANCELLED, cancel_requested_at=now, finished_at=now, updated_at=now
        )
        if not cancelled:
            flagged = Job.objects.filter(pk=job.pk, status=Job.Status.RUNNING).update(
                cancel_requested_at=now, updated_at=now
            )
            if not flagged:
                raise AppError(409, ErrorCode.JOB_NOT_CANCELLABLE, f"Job already {job.status}")
        # revoke 只是加速:讓還在佇列裡的訊息被 worker 收到時直接丟掉(revoke 清單存在 worker
        # 記憶體,worker 重啟就忘了)。真正可靠的是上面的 DB 旗標——task 開跑前與每個檢查點都會看。
        task_id = job.celery_task_id
        transaction.on_commit(lambda: _revoke(task_id))
        logger.info("[Service] job cancel requested - id: {id}, owner: {uid}", id=job.pk, uid=user.pk)
        job.refresh_from_db()
        return job

    @staticmethod
    def purge_old() -> int:
        days = settings.JOB_RETENTION_DAYS
        if days == 0:
            return 0
        deleted, _ = Job.objects.filter(finished_at__lt=timezone.now() - timedelta(days=days)).delete()
        return deleted


def _revoke(task_id: str) -> None:
    from config.celery import app as celery_app

    try:
        celery_app.control.revoke(task_id)
    except BrokerError:
        logger.warning("[Service] job revoke failed (broker unavailable), relying on cancel flag")


class JobHandle:
    """task 內操作自己那筆 Job 的把手。每個方法都是單一條件式 UPDATE,不需要鎖。"""

    def __init__(self, job_id: int) -> None:
        self.job_id = job_id

    @classmethod
    def claim(cls, job_id: int) -> JobHandle | None:
        """pending → running。回傳 None = 不該執行(已取消、已結束、或另一個 worker 正在跑)。

        acks_late 下 worker 死掉,訊息會在 visibility_timeout 後重送;那時這筆 job 還卡在
        running。started_at 早於 CELERY_TASK_TIME_LIMIT 的 running 一定是死掉的那次,允許重新認領。
        """
        now = timezone.now()
        stale = now - timedelta(seconds=settings.CELERY_TASK_TIME_LIMIT)
        claimed = (
            Job.objects.filter(pk=job_id, cancel_requested_at__isnull=True)
            .filter(Q(status=Job.Status.PENDING) | Q(status=Job.Status.RUNNING, started_at__lt=stale))
            .update(status=Job.Status.RUNNING, started_at=now, progress=0, updated_at=now)
        )
        return cls(job_id) if claimed else None

    def progress(self, percent: int, message: str = "") -> None:
        """回報進度,同時是取消檢查點:已被要求取消就丟 ``JobCancelled``。"""
        updated = Job.objects.filter(
            pk=self.job_id, status=Job.Status.RUNNING, cancel_requested_at__isnull=True
        ).update(progress=max(0, min(100, percent)), message=message[:255], updated_at=timezone.now())
        if not updated:
            raise JobCancelled

    def check_cancelled(self) -> None:
        """不更新進度、只檢查取消(迴圈很密時用,避免每圈都寫 DB 的話就隔幾圈呼叫一次)。"""
        if Job.objects.filter(pk=self.job_id, cancel_requested_at__isnull=False).exists():
            raise JobCancelled

    def succeed(self, result: Any) -> None:
        self._finish(Job.Status.SUCCEEDED, progress=100, result=result)

    def fail(self, code: str = JOB_ERROR_INTERNAL, message: str = "") -> None:
        self._finish(Job.Status.FAILED, error=code[:64], message=message[:255])

    def cancel(self) -> None:
        self._finish(Job.Status.CANCELLED, message="Cancelled")

    def _finish(self, status: str, **fields: Any) -> None:
        now = timezone.now()
        Job.objects.filter(pk=self.job_id, status=Job.Status.RUNNING).update(
            status=status, finished_at=now, updated_at=now, **fields
        )
        logger.info("[Job] finished - id: {id}, status: {s}", id=self.job_id, s=status)
