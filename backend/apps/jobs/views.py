from ninja import Query, Router
from ninja.responses import Status

from apps.accounts.authentication import BearerAuth
from apps.core.pagination import StandardPagination
from apps.core.schema import BaseResponse, Page
from apps.core.throttling import WriteRateThrottle
from apps.jobs.schema import DemoJobRequest, JobResponse
from apps.jobs.services import JobService
from apps.jobs.tasks import demo_countdown

# Router-level auth: every endpoint below requires a valid bearer token; jobs are owner-scoped.
jobs_router = Router(tags=["jobs"], auth=BearerAuth())


@jobs_router.get("", response=BaseResponse[Page[JobResponse]])
def list_jobs(request, page: StandardPagination.Input = Query(...)):
    """The caller's own jobs, newest first."""
    return BaseResponse(data=StandardPagination().paginate_queryset(JobService.owned_qs(request.auth), page, request))


@jobs_router.get("/{int:job_id}", response=BaseResponse[JobResponse])
def get_job(request, job_id: int):
    """Status / progress of one of the caller's jobs (another user's job → 404). Poll this."""
    return BaseResponse(data=JobService.get_owned_or_404(request.auth, job_id))


@jobs_router.post("/{int:job_id}/cancel", response=BaseResponse[JobResponse], throttle=[WriteRateThrottle()])
def cancel_job(request, job_id: int):
    """Pending → cancelled immediately; running → stops at the task's next checkpoint
    (``cancel_requested`` is true until then). Finished jobs → 409 ``job_not_cancellable``."""
    return BaseResponse(data=JobService.cancel_owned(request.auth, job_id))


@jobs_router.post("/demo", response={201: BaseResponse[JobResponse]}, throttle=[WriteRateThrottle()])
def start_demo_job(request, payload: DemoJobRequest):
    """Start the demo long-running job (replace with a real task — see apps/jobs/tasks.py)."""
    job = JobService.start(request.auth, demo_countdown, steps=payload.steps, delay_seconds=payload.delay_seconds)
    return Status(201, BaseResponse(data=job))
