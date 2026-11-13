"""長任務的 task 寫法:``@shared_task`` 疊在 ``@tracked_job`` 上,函式第一個參數拿到 ``JobHandle``。

    @shared_task(name="reports.build_monthly_report")
    @tracked_job
    def build_monthly_report(job: JobHandle, month: str) -> dict:
        for i, chunk in enumerate(chunks):
            ...                                  # 做一段工作
            job.progress(i * 100 // len(chunks))  # 回報進度 + 取消檢查點
        return {"rows": n}                       # → Job.result

發起:``JobService.start(user, build_monthly_report, month="2026-10")``(view 端,見 views.py)。
- 檢查點越密,取消反應越快;但每次 ``progress()`` 是一次 UPDATE,迴圈很密時隔幾圈呼叫一次。
- 使用者可處理的失敗就 ``raise JobFailed("invalid_file", "第 3 列日期格式錯誤")``(error = 錯誤碼);
  其他例外一律 error="internal_error"(細節在 log/Sentry)。
- 仍受全域 soft/hard time limit 約束(300s/360s);更長的工作請拆小或對這支 task 個別放寬。
"""

import functools
import time
from collections.abc import Callable
from typing import Any

from celery import shared_task
from loguru import logger

from apps.jobs.services import JobCancelled, JobFailed, JobHandle, JobService


def tracked_job(func: Callable[..., Any]) -> Callable[..., str]:
    """把 task 本體包上 Job 狀態流轉:認領 → 執行 → succeeded / failed / cancelled。冪等(重送會 skip)。"""

    @functools.wraps(func)
    def wrapper(job_id: int, **kwargs: Any) -> str:
        job = JobHandle.claim(job_id)
        if job is None:
            logger.info("[Task] job not claimable (cancelled/finished/running elsewhere) - id: {id}", id=job_id)
            return "skipped"
        try:
            result = func(job, **kwargs)
        except JobCancelled:
            job.cancel()
            return "cancelled"
        except JobFailed as exc:
            job.fail(exc.code, exc.message)
            return "failed"
        except Exception:
            # 未預期的例外:狀態標 failed(不把內部細節給使用者看),再往外丟讓 Celery/Sentry 記錄。
            logger.exception("[Task] job crashed - id: {id}", id=job_id)
            job.fail()
            raise
        job.succeed(result)
        return "succeeded"

    return wrapper


@shared_task(name="jobs.demo_countdown")
@tracked_job
def demo_countdown(job: JobHandle, steps: int = 10, delay_seconds: float = 1.0) -> dict[str, int]:
    """示範用的長任務:分 ``steps`` 段、每段睡 ``delay_seconds`` 秒並回報進度。換成真正的工作即可。"""
    for i in range(1, steps + 1):
        time.sleep(delay_seconds)
        job.progress(i * 100 // steps, f"step {i}/{steps}")
    return {"steps": steps}


@shared_task(name="jobs.purge_old_jobs")
def purge_old_jobs() -> int:
    deleted = JobService.purge_old()
    logger.info("[Task] purged {n} finished jobs", n=deleted)
    return deleted
