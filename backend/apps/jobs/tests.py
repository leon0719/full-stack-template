from datetime import timedelta

import pytest
from django.test import Client
from django.utils import timezone

from apps.jobs.models import Job
from apps.jobs.services import JobFailed, JobHandle, JobService
from apps.jobs.tasks import demo_countdown, tracked_job


@pytest.fixture(autouse=True)
def _reset_throttle_counters():
    from django.core.cache import cache

    cache.clear()


@pytest.fixture
def applied(monkeypatch):
    """Capture Task.apply_async calls instead of talking to a broker."""
    calls: list[dict] = []

    def fake_apply_async(self, args=None, kwargs=None, task_id=None, **options):
        calls.append({"task": self.name, "kwargs": kwargs, "task_id": task_id})

    monkeypatch.setattr("celery.app.task.Task.apply_async", fake_apply_async)
    return calls


def _job(owner, **fields) -> Job:
    fields.setdefault("celery_task_id", f"task-{Job.objects.count()}")
    return Job.objects.create(owner=owner, kind="jobs.demo_countdown", **fields)


# ==================== service / task lifecycle ====================


@pytest.mark.integration
def test_start_creates_pending_job_and_enqueues_on_commit(user, applied, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        job = JobService.start(user, demo_countdown, steps=3, delay_seconds=0)

    assert (job.status, job.progress, job.kind) == ("pending", None, "jobs.demo_countdown")
    assert applied == [
        {
            "task": "jobs.demo_countdown",
            "kwargs": {"job_id": job.pk, "steps": 3, "delay_seconds": 0},
            "task_id": job.celery_task_id,
        }
    ]


@pytest.mark.integration
def test_enqueue_failure_marks_job_failed(user, monkeypatch, django_capture_on_commit_callbacks):
    from kombu.exceptions import OperationalError

    def broker_down(self, *args, **kwargs):
        raise OperationalError("broker unreachable")

    monkeypatch.setattr("celery.app.task.Task.apply_async", broker_down)
    with django_capture_on_commit_callbacks(execute=True):
        job = JobService.start(user, demo_countdown)

    job.refresh_from_db()
    assert (job.status, job.error) == ("failed", "enqueue_failed")


@pytest.mark.integration
def test_demo_task_runs_to_success_with_progress(user):
    job = _job(user)

    assert demo_countdown(job_id=job.pk, steps=4, delay_seconds=0) == "succeeded"

    job.refresh_from_db()
    assert (job.status, job.progress, job.result, job.error) == ("succeeded", 100, {"steps": 4}, "")
    assert job.started_at is not None and job.finished_at is not None


@pytest.mark.integration
def test_task_is_idempotent_on_redelivery(user):
    job = _job(user)
    demo_countdown(job_id=job.pk, steps=1, delay_seconds=0)
    assert demo_countdown(job_id=job.pk, steps=1, delay_seconds=0) == "skipped"


@pytest.mark.integration
def test_cancel_flag_stops_running_task_at_next_checkpoint(user):
    job = _job(user)

    @tracked_job
    def task(handle: JobHandle) -> None:
        handle.progress(10)
        Job.objects.filter(pk=handle.job_id).update(cancel_requested_at=timezone.now())  # user hits cancel
        handle.progress(20)  # checkpoint notices the flag
        pytest.fail("should have stopped at the checkpoint")

    assert task(job_id=job.pk) == "cancelled"
    job.refresh_from_db()
    assert (job.status, job.progress) == ("cancelled", 10)


@pytest.mark.integration
def test_job_failed_exposes_code_but_crash_does_not(user):
    @tracked_job
    def expected_failure(handle: JobHandle) -> None:
        raise JobFailed("invalid_file", "row 3 has a bad date")

    @tracked_job
    def crash(handle: JobHandle) -> None:
        raise KeyError("internal detail /etc/secret")

    a, b = _job(user), _job(user)
    assert expected_failure(job_id=a.pk) == "failed"
    with pytest.raises(KeyError):
        crash(job_id=b.pk)

    a.refresh_from_db()
    b.refresh_from_db()
    assert (a.status, a.error, a.message) == ("failed", "invalid_file", "row 3 has a bad date")
    assert (b.status, b.error) == ("failed", "internal_error")
    assert "secret" not in b.message


@pytest.mark.integration
def test_stale_running_job_can_be_reclaimed_after_worker_death(user, settings):
    job = _job(user, status=Job.Status.RUNNING, started_at=timezone.now())
    assert JobHandle.claim(job.pk) is None  # still within the time limit: another worker owns it

    Job.objects.filter(pk=job.pk).update(
        started_at=timezone.now() - timedelta(seconds=settings.CELERY_TASK_TIME_LIMIT + 1)
    )
    assert JobHandle.claim(job.pk) is not None


@pytest.mark.integration
def test_purge_old_jobs_removes_only_old_finished(user, settings):
    from apps.jobs.tasks import purge_old_jobs

    settings.JOB_RETENTION_DAYS = 7
    old = _job(user, status=Job.Status.SUCCEEDED, finished_at=timezone.now() - timedelta(days=8))
    _job(user, status=Job.Status.SUCCEEDED, finished_at=timezone.now())
    _job(user)  # pending, never finished

    assert purge_old_jobs() == 1
    assert not Job.objects.filter(pk=old.pk).exists()


# ==================== endpoints ====================


@pytest.mark.integration
def test_get_job_shape_matches_frontend_contract(user, auth_headers):
    job = _job(user)

    data = Client().get(f"/jobs/{job.pk}", headers=auth_headers).json()["data"]

    # shared/api/use-job-polling.ts → Job { id, status, progress, result, error }
    assert {k: data[k] for k in ("id", "status", "progress", "result", "error")} == {
        "id": job.pk,
        "status": "pending",
        "progress": None,
        "result": None,
        "error": None,
    }


@pytest.mark.integration
def test_jobs_are_owner_scoped(user, auth_headers, other_auth_headers):
    job = _job(user)
    client = Client()

    assert client.get(f"/jobs/{job.pk}", headers=other_auth_headers).status_code == 404
    assert client.post(f"/jobs/{job.pk}/cancel", headers=other_auth_headers).status_code == 404
    assert client.get("/jobs", headers=other_auth_headers).json()["data"]["count"] == 0
    job.refresh_from_db()
    assert job.status == "pending"  # the other user's cancel attempt changed nothing


@pytest.mark.integration
def test_jobs_require_auth(db):
    assert Client().get("/jobs").status_code == 401
    assert Client().get("/jobs/1").status_code == 401


@pytest.mark.integration
def test_cancel_pending_running_and_finished(user, auth_headers, monkeypatch):
    revoked: list[str] = []
    monkeypatch.setattr("apps.jobs.services._revoke", revoked.append)
    client = Client()
    pending = _job(user)
    running = _job(user, status=Job.Status.RUNNING, started_at=timezone.now(), progress=40)
    done = _job(user, status=Job.Status.SUCCEEDED)

    resp = client.post(f"/jobs/{pending.pk}/cancel", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "cancelled"

    resp = client.post(f"/jobs/{running.pk}/cancel", headers=auth_headers)
    body = resp.json()["data"]
    assert (body["status"], body["cancel_requested"], body["progress"]) == ("running", True, 40)

    resp = client.post(f"/jobs/{done.pk}/cancel", headers=auth_headers)
    assert resp.status_code == 409
    assert resp.json()["error"]["reason"] == "job_not_cancellable"


@pytest.mark.integration
def test_cancel_revokes_after_commit(user, monkeypatch, django_capture_on_commit_callbacks):
    revoked: list[str] = []
    monkeypatch.setattr("apps.jobs.services._revoke", revoked.append)
    job = _job(user)

    with django_capture_on_commit_callbacks(execute=True):
        JobService.cancel_owned(user, job.pk)

    assert revoked == [job.celery_task_id]


@pytest.mark.integration
def test_start_demo_endpoint(user, auth_headers, applied, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        resp = Client().post(
            "/jobs/demo",
            data={"steps": 2, "delay_seconds": 0},
            content_type="application/json",
            headers=auth_headers,
        )

    assert resp.status_code == 201
    job_id = resp.json()["data"]["id"]
    assert Job.objects.get(pk=job_id).owner_id == user.id
    assert applied[0]["kwargs"] == {"job_id": job_id, "steps": 2, "delay_seconds": 0.0}
