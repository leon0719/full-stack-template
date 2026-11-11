# CLAUDE.md

Backend half of the full-stack monorepo. Response language, human-only operations, Git rules, and the
frontend–backend contract are in [../CLAUDE.md](../CLAUDE.md) and apply here.
This file holds only the rules every backend task touches; task-specific detail lives in `docs/` and
`.claude/skills/` — read the pointed-to file before working in that area instead of guessing.

## Project Overview

Django Ninja REST API with Celery task queue, PostgreSQL, Redis, and Docker-based development.
Uses `uv` as the package manager, Python 3.15+. Version trade-offs (Django 6.1 vs LTS, the
django-celery-beat override) are in `README.md`.

## Commands

### Development Environment (Docker)
- `make up` / `make down` / `make rebuild` (after Dockerfile or dependency changes)
- `make logs-api` / `make logs-worker` — Service-specific logs

### Code Quality (runs locally, not in Docker)
- `make all` — Format + lint + type-check
- `make format` / `make lint` (`ruff check --fix .`) / `make type-check` (`mypy .`)
- `make unused` — Check for unused functions/classes/constants

### Testing
- `make test-local` — Fastest feedback: all tests locally on in-memory SQLite (no Docker needed)
- `make test` — All tests against Postgres in Docker; `make test TEST=apps/health/tests.py` for one file
- `uv run pytest -m unit` / `uv run pytest -m "not slow"` — marker subsets

> `make type-check` / `test-local` / `makemigrations-local` load `.env.local` if present, otherwise
> inject dummy `SECRET_KEY`/`DATABASE_URL` (`config.settings.local` builds the pydantic `Settings()`
> at import). Running `uv run pytest`/`mypy` bare without that env fails at import.

### Dependencies
- `make install` — Install locally (for IDE support)
- `make update` — Upgrade all packages and update pyproject.toml lower bounds

### Django Management
- `make makemigrations-local APP=<app>` — locally, no Docker needed
- `make migrate` / `make makemigrations` / `make shell` / `make createsuperuser` — in Docker

## Architecture

```
Client → Uvicorn (ASGI) → Django Ninja API (config/urls.py)
                            ├── Exception handlers (config/exceptions.py)
                            ├── orjson parser/renderer (config/ninja_config.py)
                            └── Routers (apps/*/views.py)
```

### Configuration (`config/`)
- **Settings**: Pydantic Settings in `settings/base.py` reads `.env.{ENV}`; `local.py`/`prod.py` override.
  All env vars flow through the `Settings` class — no raw `os.getenv()` in app code.
  New *required* prod setting → also add a fake value to `.env.ci` (CI's `check --deploy` + docker smoke test
  read only that file) and document it in `.env.prod.example`; `config/test_ci_env.py` fails until both are done.
- **Responses**: endpoints declare `response=BaseResponse[XxxResponse]` and `return BaseResponse(data=...)`
  (`apps/core/schema.py`); delete → 200 + `BaseResponse()`, not 204. `/` and `/health/*` are probes, not wrapped.
- **Errors**: raise `AppError(status, ErrorCode.X, message)` (`config/errors.py`; client-branchable, becomes
  `error.reason`) or plain `HttpError` (`reason: null`); `exceptions.py` renders the envelope. Never
  hand-build an error response.

### App Layering (file responsibilities)
- **views.py** — Django Ninja endpoints only. HTTP-layer delegation; no business logic, no ORM.
- **schema.py** — Ninja/Pydantic request & response schemas (`*Request` / `*Response`).
- **services.py** — business logic. Stateless; raises `AppError`/`HttpError`; no `httpx`.
- **external_services.py** — the *only* place third-party HTTP calls (`httpx`) live; wrap each call
  with `@handle_api_call` / `@handle_api_call_graceful` (`config/external_api_handler.py`).
- **utils.py** — pure helpers, no side effects, no DB.
- **tasks.py** — Celery `@shared_task`s; pass primitive args; idempotent (broker uses `acks_late`).
- **models.py** — explicit `on_delete` + `related_name`; index real query paths.

New app → use the **scaffold-app** skill. New endpoint/resource → **add-resource**. New model → **register-admin**.

### Reference apps (copy their shape, don't reinvent)
- **`apps/articles`** — canonical CRUD: router `auth=BearerAuth()`, owner-scoped `get_owned_or_404()`
  (IDOR → 404), `StandardPagination` inside `BaseResponse`, `FilterSchema` (`?status=&q=`),
  `WriteRateThrottle`, atomic-claim Celery side effect, `external_services.py` webhook example.
- **`apps/accounts`** — LINE-only login via django-allauth; `adapters.py` trades the login for a one-time
  exchange code, `POST /auth/line/exchange` (per-IP `LoginThrottle`) returns an opaque bearer token
  (SHA-256 digest stored). `BearerAuth` guards `POST /auth/logout`, `GET /auth/me`.
- **`apps/health`** — `/health/live` (process only) and `/health/ready` (DB + cache + Celery).

Auth/throttle/paginator classes are stock Django Ninja — no Knox/DRF/django-ratelimit. Throttle counters
use the Django cache: Redis in `base.py`, in-memory in `local.py` (tests need no Redis).

## Deliberate decisions — not tech debt, don't "fix" them in a task

Reasoning lives in the `❌` rows of `docs/backend-standards.md` / `docs/api-standards.md`; propose changes separately, never inside an unrelated task.
- No Repository/DAO layer — Django `Manager`/`QuerySet` already is one.
- No DI container / interface injection — reuse via mixins, test with fixtures + real test DB.
- `BigAutoField` primary keys, not UUID (IDOR is handled by owner scoping).
- Envelope is `BaseResponse` with a `reason` string code, not RFC 9457 (`type`/`instance`/`problem+json`).
- No `@paginate` decorator — its output can't be wrapped in `BaseResponse`; call `paginate_queryset` in the view.

## Code Style
- Line length 120; ruff rules in `pyproject.toml` (incl. `DTZ`, `BLE`, `S`)
- Datetimes timezone-aware — `django.utils.timezone.now()`
- loguru `logger`, never stdlib `logging`. 4xx → `logger.warning`, 5xx → `logger.error`
- Blind `except Exception` only in boundary layers (`views.py` / `tasks.py`), always log + convert
- Async views: wrap ORM calls in `sync_to_async`
- Test markers `unit` / `integration` / `slow` (strict); shared fixtures in `conftest.py`
- Targeted `# noqa` / `# type: ignore` only, with a reason

## Before you finish
Run the **check** skill (ruff format + lint, mypy, pytest). After changing a schema or endpoint, run
`make gen-api` from the repo root. For review, **conventions-review** (project rules) complements the
built-in `/code-review` (bugs). Report unverified items as unverified — never tick something you didn't run.

## Docs (`docs/`) — read before working in that area
- `api-standards.md` — **before adding/changing endpoints** (errors, pagination, throttling, idempotency, CORS)
- `backend-standards.md` — **before adding an app/service/migration** (layering, DB, secrets, observability, tests)
- `integration-standards.md` — **before third-party APIs, caching, Celery, webhooks**
- `local-development.md` — env vars, daily commands, troubleshooting
- `deployment.md` — `.env.prod`, deploy steps, Docker/whitenoise/proxy headers
- `caddy.md` — Cloudflare + Caddy, real client IP, `FORWARDED_ALLOW_IPS` / `NINJA_NUM_PROXIES`
- `alerting.md` — Sentry/Slack, beat heartbeat, queue depth, failure signals
