import os
from pathlib import Path

import dj_database_url
from celery.schedules import crontab
from pydantic import Field, PositiveInt, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_env = os.getenv("ENV", "local")
_env_file = f".env.{_env}"

BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Dev-friendly defaults for ALLOWED_HOSTS / CORS_ALLOWED_ORIGINS (Docker + common
# frontend dev ports). Extracted so the prod validator can reject them: every real
# deployment must set its own values (see Settings._validate_prod).
_DEV_ALLOWED_HOSTS = "localhost,127.0.0.1,0.0.0.0,host.docker.internal"
_DEV_CORS_ALLOWED_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173"
# Dev broker/cache defaults (Docker Compose service names). Extracted so the prod
# validator can reject them: prod pointing at these would silently talk to a
# non-existent, password-less Redis (see Settings._validate_prod).
_DEV_CELERY_BROKER_URL = "redis://redis:6379/0"
_DEV_CACHE_URL = "redis://redis:6379/1"

# Explicit opt-out value for SENTRY_DSN in prod. Prod refuses to boot with an
# empty DSN (see Settings._validate_prod) so that "no error tracking" can only
# ever be a deliberate choice, never an oversight.
SENTRY_DSN_OPT_OUT = "disabled"


# ---------------------------------------------------------------------------
# Pydantic Settings (env-driven)
# ---------------------------------------------------------------------------
class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_env_file,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Required (secrets — wrapped in SecretStr so they never leak into logs/repr;
    # unwrap with .get_secret_value() when handing them to Django/Celery below)
    SECRET_KEY: SecretStr
    DATABASE_URL: SecretStr

    # Optional
    ENV: str = "local"
    # Dev-friendly fallbacks (Docker + common frontend dev ports); every real
    # deployment sets these in its .env file (prod rejects the dev defaults).
    ALLOWED_HOSTS: str = _DEV_ALLOWED_HOSTS
    CORS_ALLOWED_ORIGINS: str = _DEV_CORS_ALLOWED_ORIGINS
    # Origins trusted for CSRF checks (Django admin, any cookie-authed form).
    # Semantically distinct from CORS: set this to the API's own https origin(s).
    CSRF_TRUSTED_ORIGINS: str = ""
    CELERY_BROKER_URL: SecretStr = SecretStr(_DEV_CELERY_BROKER_URL)
    CACHE_URL: SecretStr = SecretStr(_DEV_CACHE_URL)
    GIT_COMMIT_SHA: str = ""

    # Use a psycopg3 connection pool (Postgres only). Off by default.
    DB_CONN_POOL: bool = False

    # django-ninja throttling: number of trusted reverse proxies in front of the
    # app. MUST match the proxy hop count implied by FORWARDED_ALLOW_IPS —
    # otherwise per-IP throttles can be bypassed via X-Forwarded-For spoofing
    # (consumed by prod.py; see its NINJA_NUM_PROXIES comment).
    NINJA_NUM_PROXIES: int = Field(default=1, ge=0)

    # Sentry (error tracking) — leave DSN empty to disable (local/test default).
    # In prod the DSN is REQUIRED: shipping without error tracking means failures
    # are invisible. Opting out is possible but must be explicit — set the DSN to
    # SENTRY_DSN_OPT_OUT ("disabled") so it's a decision, not an oversight.
    SENTRY_DSN: SecretStr = SecretStr("")
    SENTRY_TRACES_SAMPLE_RATE: float = Field(default=0.0, ge=0.0, le=1.0)
    SENTRY_PROFILES_SAMPLE_RATE: float = Field(default=0.0, ge=0.0, le=1.0)

    # Heartbeat URL for an external uptime monitor (healthchecks.io, Better Stack,
    # Cronitor…). celery-beat pings it on a schedule; if beat stops running the
    # ping stops arriving and the monitor alerts. Empty disables the heartbeat.
    #
    # This covers the blind spot Sentry cannot: Sentry only hears about code that
    # RAN and threw. A beat process that died, or a worker container that never
    # came back up, produces silence — and silence looks identical to "healthy".
    BEAT_HEARTBEAT_URL: SecretStr = SecretStr("")

    # Alert when the Celery queue backlog exceeds this many messages. A growing
    # backlog means workers can't keep up — no individual task fails, so nothing
    # else would ever tell you. 0 disables the check.
    CELERY_QUEUE_DEPTH_ALERT_THRESHOLD: int = Field(default=1000, ge=0)

    # Auth
    AUTH_TOKEN_TTL_DAYS: PositiveInt = 7

    # Throttle rates (Django Ninja rate strings, e.g. "30/m")
    THROTTLE_WRITE_RATE: str = "30/m"
    THROTTLE_LOGIN_RATE: str = "10/m"
    THROTTLE_REGISTER_RATE: str = "5/h"

    # Pagination
    PAGE_SIZE: PositiveInt = 20
    MAX_PAGE_SIZE: PositiveInt = 100

    # Webhook notified when an article is published — empty disables the call
    # (demo consumer of config/external_api_handler.py)
    ARTICLE_PUBLISHED_WEBHOOK_URL: str = ""

    def _parse_comma_separated(self, value: str) -> list[str]:
        return [v.strip() for v in value.split(",") if v.strip()]

    def get_allowed_hosts(self) -> list[str]:
        return self._parse_comma_separated(self.ALLOWED_HOSTS)

    def get_cors_allowed_origins(self) -> list[str]:
        return self._parse_comma_separated(self.CORS_ALLOWED_ORIGINS)

    def get_csrf_trusted_origins(self) -> list[str]:
        return self._parse_comma_separated(self.CSRF_TRUSTED_ORIGINS)

    @model_validator(mode="after")
    def _validate_prod(self) -> Settings:
        """Boot-time hardening for prod only — fail fast on unsafe defaults.

        Runs for every env but only enforces in prod, so local/test keep the
        dev-friendly defaults. Raises (blocking startup) when prod still carries
        a placeholder SECRET_KEY or the dev ALLOWED_HOSTS / CORS defaults.
        """
        if self.ENV != "prod":
            return self

        secret = self.SECRET_KEY.get_secret_value()
        lowered = secret.lower()
        _placeholders = {"your-secret-key-here", "<generate-new-key>"}
        if lowered in _placeholders or "change" in lowered or "placeholder" in lowered or len(secret) < 50:
            raise ValueError(
                "SECRET_KEY is unsafe: prod needs a non-placeholder key of length >= 50. "
                'Generate one: python -c "import secrets; print(secrets.token_urlsafe(50))"'
            )

        if not self.ALLOWED_HOSTS.strip() or self.ALLOWED_HOSTS == _DEV_ALLOWED_HOSTS:
            raise ValueError("ALLOWED_HOSTS not set: prod must specify real domains, not the dev defaults.")

        if not self.CORS_ALLOWED_ORIGINS.strip() or self.CORS_ALLOWED_ORIGINS == _DEV_CORS_ALLOWED_ORIGINS:
            raise ValueError("CORS_ALLOWED_ORIGINS not set: prod must specify frontend origins, not the dev defaults.")

        # The broker/cache carry no auth in the dev defaults and point at a Compose
        # service name that won't exist in prod — fail fast instead of silently
        # degrading (throttling relies on the cache; tasks on the broker).
        if self.CELERY_BROKER_URL.get_secret_value() == _DEV_CELERY_BROKER_URL:
            raise ValueError("CELERY_BROKER_URL not set: prod must point at its own broker, not the dev default.")

        if self.CACHE_URL.get_secret_value() == _DEV_CACHE_URL:
            raise ValueError("CACHE_URL not set: prod must point at its own cache, not the dev default.")

        # Error tracking is not optional-by-accident. Every other prod check here
        # guards against an unsafe value; this one guards against the absence of
        # any way to LEARN that something is wrong. Left as a plain optional, the
        # overwhelmingly common outcome is a service running for months with
        # nobody watching it.
        if not self.SENTRY_DSN.get_secret_value().strip():
            raise ValueError(
                "SENTRY_DSN not set: prod must have error tracking configured, otherwise failures "
                "are silent. Set the DSN from your Sentry project (and wire a Slack alert rule — "
                f'see docs/alerting.md), or set SENTRY_DSN="{SENTRY_DSN_OPT_OUT}" to opt out explicitly.'
            )

        return self


settings = Settings()  # type: ignore[call-arg]

# ---------------------------------------------------------------------------
# Django Core Settings
# ---------------------------------------------------------------------------
SECRET_KEY = settings.SECRET_KEY.get_secret_value()
# DEBUG is fixed per settings module (local.py=True, prod.py=False) — it is
# deliberately NOT env-configurable, so prod can never be flipped into DEBUG
# through the environment.
DEBUG = False
ALLOWED_HOSTS = settings.get_allowed_hosts()
ENV = settings.ENV

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "django_celery_beat",
    "apps.core",
    "apps.health",
    "apps.accounts",
    "apps.articles",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Serves STATIC_ROOT (admin CSS/JS) directly from the ASGI app — no nginx
    # required. In DEBUG it falls back to staticfiles finders automatically.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    # Assign/bind a request id as early as possible so all logs carry it.
    "config.middleware.RequestIDMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

# REST APIs shouldn't magic-redirect on a missing trailing slash. With the
# default (True), a slash-less non-GET (POST/PATCH/DELETE) to a slash route
# (e.g. POST /articles vs the /articles/ route) makes CommonMiddleware raise
# RuntimeError → a raw 500 outside NinjaAPI's exception handlers. False turns
# that into a clean 404 and stops GET requests being silently 301-redirected.
APPEND_SLASH = False

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# Served by uvicorn (ASGI only; see uvicorn_run.py). No WSGI entry point.
ASGI_APPLICATION = "config.asgi.application"

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
DATABASES = {"default": dj_database_url.config(default=settings.DATABASE_URL.get_secret_value())}
if settings.DB_CONN_POOL and DATABASES["default"].get("ENGINE") == "django.db.backends.postgresql":
    # psycopg3 connection pool — reuses connections under concurrency. The pool
    # owns connection lifecycle, so persistent connections (CONN_MAX_AGE) must
    # be disabled. Opt-in via DB_CONN_POOL=true (needs psycopg[pool]).
    DATABASES["default"]["CONN_MAX_AGE"] = 0
    DATABASES["default"].setdefault("OPTIONS", {})["pool"] = {"min_size": 2, "max_size": 10}
else:
    # Persistent connections: reuse a connection for up to 10 min (no pool).
    # Health-check before reuse so a DB restart/failover doesn't surface as a
    # burst of 500s from stale connections.
    DATABASES["default"]["CONN_MAX_AGE"] = 600
    DATABASES["default"]["CONN_HEALTH_CHECKS"] = True

# ---------------------------------------------------------------------------
# Password validation
# ---------------------------------------------------------------------------
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------
# Argon2 first (memory-hard, resists GPU brute force). The remaining entries are
# Django's built-in defaults kept in order so existing hashes stay verifiable and
# are transparently re-hashed to Argon2 on the user's next login. Requires the
# argon2-cffi package (see pyproject.toml).
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
]

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = settings.get_cors_allowed_origins()

# ---------------------------------------------------------------------------
# Cache (Redis) — also backs Django Ninja throttling counters.
# local.py overrides this with an in-memory cache so tests need no Redis.
# ---------------------------------------------------------------------------
# Exposed as a module-level setting so the readiness probe can health-check it.
CACHE_URL = settings.CACHE_URL.get_secret_value()
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": CACHE_URL,
        # Fail fast when Redis is unresponsive: every throttled request touches
        # the cache, and without socket timeouts a hung Redis blocks requests
        # until the OS-level TCP timeout (minutes).
        "OPTIONS": {"socket_connect_timeout": 2, "socket_timeout": 2},
    }
}

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
AUTH_TOKEN_TTL_DAYS = settings.AUTH_TOKEN_TTL_DAYS

# ---------------------------------------------------------------------------
# Throttling rates (consumed by apps.core.throttling)
# ---------------------------------------------------------------------------
THROTTLE_WRITE_RATE = settings.THROTTLE_WRITE_RATE
THROTTLE_LOGIN_RATE = settings.THROTTLE_LOGIN_RATE
THROTTLE_REGISTER_RATE = settings.THROTTLE_REGISTER_RATE

# ---------------------------------------------------------------------------
# Pagination (consumed by apps.core.pagination)
# ---------------------------------------------------------------------------
PAGE_SIZE = settings.PAGE_SIZE
MAX_PAGE_SIZE = settings.MAX_PAGE_SIZE

# ---------------------------------------------------------------------------
# External integrations (consumed by apps.articles.external_services)
# ---------------------------------------------------------------------------
ARTICLE_PUBLISHED_WEBHOOK_URL = settings.ARTICLE_PUBLISHED_WEBHOOK_URL

# ---------------------------------------------------------------------------
# Internationalization
# ---------------------------------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------------------
# Celery
# ---------------------------------------------------------------------------
CELERY_BROKER_URL = settings.CELERY_BROKER_URL.get_secret_value()
# All tasks here are fire-and-forget — nothing reads AsyncResult, so storing
# results would only add Redis writes and a backend to operate. Flip this off
# (and configure CELERY_RESULT_BACKEND) if a task's return value is ever needed.
CELERY_TASK_IGNORE_RESULT = True
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE
CELERY_ENABLE_UTC = True
CELERY_TASK_SOFT_TIME_LIMIT = 300
CELERY_TASK_TIME_LIMIT = 360
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"
# Reliability: ACK only after a task finishes so a lost worker re-queues the job
# (requires tasks to be idempotent). Prefetch 1 keeps long/IO-bound tasks from
# being hoarded by a single worker.
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
# Redis broker: how long an unacked (acks_late) task stays invisible before the
# broker re-delivers it. Must stay ABOVE CELERY_TASK_TIME_LIMIT, otherwise
# long-running tasks get duplicated mid-execution. Explicit here even though it
# matches the Redis transport default (3600s) so the invariant is visible.
# Socket timeouts keep enqueue calls (.delay() in request handlers) and the
# readiness probe from hanging on an unresponsive broker.
CELERY_BROKER_TRANSPORT_OPTIONS = {
    "visibility_timeout": 3600,
    "socket_connect_timeout": 5,
    "socket_timeout": 10,
    "retry_on_timeout": True,
}
# Celery 6 changes this default to False; opt in explicitly so workers keep
# retrying the broker at startup (containers may start before Redis is ready).
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
# Recycle workers periodically as a leak backstop for long-running processes.
CELERY_WORKER_MAX_TASKS_PER_CHILD = 1000
# Don't let Celery replace the root logger's handlers — worker/beat logs flow
# through Django's LOGGING into loguru (JSON in prod) like everything else.
# Pairs with the setup_logging signal handler in config/celery.py.
CELERY_WORKER_HIJACK_ROOT_LOGGER = False

# Periodic tasks. DatabaseScheduler syncs these entries into the DB on beat
# startup; manage/override them afterwards from the Django admin. That runtime
# editability is what django_celery_beat buys — if your schedule is static,
# the default PersistentScheduler (drop django_celery_beat + its tables) is
# the simpler choice.
CELERY_BEAT_SCHEDULE = {
    "purge-expired-tokens": {
        "task": "accounts.purge_expired_tokens",
        "schedule": crontab(hour=3, minute=0),  # daily at 03:00 UTC
    },
    # 維運訊號(見 config/alerting.py)。頻率要比監控端設定的「多久沒收到就告警」
    # grace period 密一些,否則正常運作也會誤報。
    "beat-heartbeat": {
        "task": "core.beat_heartbeat",
        "schedule": crontab(minute="*/5"),
    },
    "check-queue-depth": {
        "task": "core.check_queue_depth",
        "schedule": crontab(minute="*/5"),
    },
}

# 攤平成 Django settings,供 apps/core/tasks.py 與 config/alerting.py 讀取
# (它們拿到的是 django.conf.settings,不是 pydantic 的 Settings 實例)。
BEAT_HEARTBEAT_URL = settings.BEAT_HEARTBEAT_URL.get_secret_value()
CELERY_QUEUE_DEPTH_ALERT_THRESHOLD = settings.CELERY_QUEUE_DEPTH_ALERT_THRESHOLD

# ---------------------------------------------------------------------------
# Static files
# ---------------------------------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# ---------------------------------------------------------------------------
# Logging (route Django logging to loguru)
# — setup_loguru() is called in local.py / prod.py after DEBUG is finalised.
# ---------------------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "loguru": {
            "class": "config.logging.LoguruHandler",
        },
    },
    "root": {
        "handlers": ["loguru"],
        "level": "INFO",  # local.py raises this to DEBUG
    },
    "loggers": {
        "django": {
            "handlers": ["loguru"],
            "level": "INFO",
            "propagate": False,
        },
        "django.db.backends": {
            "handlers": ["loguru"],
            "level": "WARNING",
            "propagate": False,
        },
    },
}

# ---------------------------------------------------------------------------
# Application info
# ---------------------------------------------------------------------------
APP_NAME = "Django Ninja Project Tree"
APP_VERSION = "0.1.0"

# Injected as a Docker build arg in prod; local runs don't need a real value.
GIT_COMMIT_SHA = settings.GIT_COMMIT_SHA or "unknown"

# ---------------------------------------------------------------------------
# Sentry (initialised only when a DSN is configured; no-op locally/in tests)
# ---------------------------------------------------------------------------
# NB: a SecretStr instance is always truthy (even when empty), so gate on the
# unwrapped value to keep the "empty DSN disables Sentry" behaviour.
# SENTRY_DSN_OPT_OUT is the explicit "we know, we chose not to" value that prod
# accepts in place of a real DSN — treat it the same as unset here.
_sentry_dsn = settings.SENTRY_DSN.get_secret_value().strip()
if _sentry_dsn and _sentry_dsn != SENTRY_DSN_OPT_OUT:
    from config.sentry import init_sentry

    init_sentry(
        dsn=_sentry_dsn,
        environment=ENV,
        release=GIT_COMMIT_SHA,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        profiles_sample_rate=settings.SENTRY_PROFILES_SAMPLE_RATE,
    )
