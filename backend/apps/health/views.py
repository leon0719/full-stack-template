import asyncio

from asgiref.sync import sync_to_async
from django.conf import settings
from django.core.cache import caches
from django.db import connection
from ninja import Router, Schema
from ninja.responses import Status

from config.celery import app as celery_app

health_router = Router()

STATUS_OK = "ok"
STATUS_ERROR = "error"
STATUS_DEGRADED = "degraded"


class HealthStatus(Schema):
    status: str
    database: bool
    cache: bool
    celery: bool


class AppInfo(Schema):
    name: str
    version: str


class LiveStatus(Schema):
    status: str


def _check_database() -> bool:
    try:
        connection.ensure_connection()
        return True
    except Exception:
        return False


def _check_cache() -> bool:
    # Probe the *configured* default cache backend (Redis in prod, LocMem in
    # local) with a set/get round-trip — checking a raw Redis URL would test
    # something the app may not even be using. The cache backs throttling,
    # which makes it a request-path dependency.
    try:
        cache = caches["default"]
        cache.set("health:ping", "1", timeout=5)
        return cache.get("health:ping") == "1"
    except Exception:
        return False


_CELERY_CHECK_CACHE_KEY = "health:celery_ok"
_CELERY_CHECK_TTL = 10  # seconds


def _check_celery() -> bool:
    # Requires the broker reachable AND at least one worker responding.
    #
    # inspect().ping() broadcasts a control message to every worker over the
    # broker and blocks for the reply — far heavier than the local DB/cache
    # probes. Memoize the result for a few seconds so a high-frequency readiness
    # probe (k8s/Docker) broadcasts at most once per _CELERY_CHECK_TTL instead
    # of once per request, closing an anonymous amplification vector. A cache
    # miss returns None (re-probe); a stored False is honoured (no re-probe).
    try:
        cache = caches["default"]
        cached = cache.get(_CELERY_CHECK_CACHE_KEY)
        if cached is not None:
            return bool(cached)
        inspect = celery_app.control.inspect(timeout=2)
        ok = bool(inspect.ping())
        cache.set(_CELERY_CHECK_CACHE_KEY, ok, timeout=_CELERY_CHECK_TTL)
        return ok
    except Exception:
        return False


async def _full_health_check() -> HealthStatus:
    """Run all dependency checks concurrently and return a HealthStatus.

    DB + cache are request-path critical; Celery is a background dependency —
    it is reported but does NOT on its own make the service unready.
    """
    db, cache_ok, celery_ok = await asyncio.gather(
        sync_to_async(_check_database)(),
        sync_to_async(_check_cache, thread_sensitive=False)(),
        sync_to_async(_check_celery, thread_sensitive=False)(),
    )
    if not (db and cache_ok):
        status = STATUS_ERROR
    elif not celery_ok:
        status = STATUS_DEGRADED
    else:
        status = STATUS_OK
    return HealthStatus(status=status, database=db, cache=cache_ok, celery=celery_ok)


@health_router.get("/", response=AppInfo)
async def root(request):
    """Public API info: name + version only.

    Intentionally omits environment name, git commit AND dependency health:
    those are host-fingerprinting / reconnaissance details that must not be
    exposed to anonymous callers. Health details live on /health/ready.
    """
    return AppInfo(name=settings.APP_NAME, version=settings.APP_VERSION)


@health_router.get("/health/live", response=LiveStatus)
def liveness(request):
    """Liveness probe — the process is up. No external dependencies checked.

    Used by the Docker HEALTHCHECK. A DB/Redis blip must NOT restart the
    container (that would cascade across replicas); readiness gates traffic.
    """
    return LiveStatus(status=STATUS_OK)


@health_router.get("/health/ready", response={200: HealthStatus, 503: HealthStatus})
async def readiness(request):
    """Readiness probe — gated on request-path deps (DB + cache).

    Celery being down yields 'degraded' but still 200, since the HTTP API can
    keep serving requests without workers.
    """
    health = await _full_health_check()
    code = 200 if health.status in (STATUS_OK, STATUS_DEGRADED) else 503
    return Status(code, health)
