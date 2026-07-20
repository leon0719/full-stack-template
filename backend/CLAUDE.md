# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Django Ninja REST API template with Celery task queue, PostgreSQL, Redis, and Docker-based development. Uses `uv` as the package manager, Python 3.14+.

### Version trade-offs
- **Django 6.0** — current default. Not an LTS: community support runs until ~2027-04.
  If you prefer a set-and-forget baseline, consider pinning to **5.2 LTS** (supported
  until ~2028-04) instead.
- **Celery 5.6** — Python 3.14 support is *initial* at this release; watch for rough
  edges and re-check compatibility when upgrading either Celery or Python.

## Commands

### Development Environment (Docker)
- `make up` — Start all dev containers (API, DB, Redis, Celery Worker, Celery Beat)
- `make down` — Stop containers
- `make rebuild` — Rebuild and restart (after Dockerfile or dependency changes)
- `make logs-api` / `make logs-worker` — Service-specific logs

### Code Quality (runs locally, not in Docker)
- `make all` — Format + lint + type-check
- `make format` — `ruff format .`
- `make lint` — `ruff check --fix .`
- `make type-check` — `mypy .`
- `make unused` — Check for unused functions/classes/constants

### Testing
- `make test` — All tests (in Docker)
- `make test TEST=apps/health/tests.py` — Single file
- `make test-local` — Run tests locally (loads `.env.local`, falls back to dummy env)
- `uv run pytest -m unit` — Run only unit tests (locally)
- `uv run pytest -m "not slow"` — Exclude slow tests

> `make type-check` / `test-local` / `makemigrations-local` load `.env.local` if present
> and otherwise inject dummy `SECRET_KEY`/`DATABASE_URL`, because `config.settings.local`
> instantiates the pydantic `Settings()` at import. Integration tests need a real DB
> (Postgres in Docker); locally they also run against an in-memory SQLite via
> `DATABASE_URL=sqlite://:memory:`.

### Dependencies
- `make install` — Install locally (for IDE support)
- `make update` — Upgrade all packages and update pyproject.toml lower bounds

### Django Management (runs in Docker)
- `make migrate` / `make makemigrations` / `make shell` / `make createsuperuser`

## Architecture

### Request Flow
```
Client → Uvicorn (ASGI) → Django Ninja API (config/urls.py)
                            ├── Exception handlers (config/exceptions.py)
                            ├── orjson parser/renderer (config/ninja_config.py)
                            └── Routers (apps/*/views.py)
```

### Configuration (`config/`)
- **Settings**: Pydantic Settings in `settings/base.py` reads from `.env.{ENV}` files. `local.py`/`prod.py` override specific values. All env vars flow through the `Settings` class — don't use raw `os.getenv()` in app code.
- **Logging**: `logging.py` integrates loguru with Django's logging system via `LoguruHandler`. Uvicorn access logs filter out health check noise via `HealthCheckFilter`. Dev = colored stderr, prod = JSON (`serialize=True`).
- **Exceptions**: `exceptions.py` registers unified JSON error handlers (422/401/404/500) on the NinjaAPI instance. The 500 handler logs via `logger.exception()`.
- **Entry point**: `uvicorn_run.py` at project root starts uvicorn with custom log config. Used by both dev and prod Docker.

### Health Check Endpoints (`apps/health/views.py`)
- `GET /` — API info only (name, version; env/git sha/health intentionally omitted — dependency status is recon info for anonymous callers).
- `GET /health/live` — process-only liveness, always 200 (no external deps). Used by Docker HEALTHCHECK.
- `GET /health/ready` — DB + cache (`caches["default"]`, i.e. what the app actually uses) + Celery; Celery down → "degraded" but still 200, DB/cache down → 503.
- `readiness()` runs checks concurrently via `asyncio.gather()` + `sync_to_async`.

### App Layering (file responsibilities)
Keep each layer in its own module so logic stays testable and HTTP concerns stay thin:
- **views.py** — Django Ninja endpoints only. HTTP-layer delegation; no business logic.
- **schema.py** — Ninja/Pydantic request & response schemas (validation).
- **services.py** — business logic. Stateless; raises domain/`HttpError`; no `httpx`.
- **external_services.py** — the *only* place third-party HTTP calls (`httpx`) live; wrap
  each call with `@handle_api_call` / `@handle_api_call_graceful` from
  `config/external_api_handler.py` (tenacity retry + loguru + `HttpError` translation).
- **utils.py** — pure helpers, no side effects, no DB.
- **tasks.py** — Celery `@shared_task`s; pass primitive args; tasks must be idempotent.
- **models.py** — ORM models; explicit `on_delete` + `related_name`; index real query paths.

### Adding a New App
1. Create `apps/<name>/` with `__init__.py`, `apps.py`, `views.py` (add `schema.py` /
   `services.py` / `tasks.py` as needed — see App Layering above)
2. Register in `INSTALLED_APPS` (`config/settings/base.py`)
3. Create a router in `views.py`, add it in `config/urls.py` via `api.add_router()`
4. Add tests in `apps/<name>/tests.py`, mark with `@pytest.mark.unit` or `@pytest.mark.integration`

### Example Apps (reference implementations of the conventions above)
- **`apps/accounts`** — token auth/authz. Opaque bearer tokens (`secrets` + SHA-256
  digest stored, raw token shown once). `authentication.BearerAuth` (a ninja `HttpBearer`)
  sets `request.auth`/`request.user`. Endpoints: `POST /auth/register`, `POST /auth/login`,
  `POST /auth/logout`, `GET /auth/me`. register/login are IP rate-limited via
  `ninja.throttling.AnonRateThrottle`.
- **`apps/articles`** — CRUD resource showing the full stack: router-level `auth=BearerAuth()`,
  owner-scoped queries with `get_owned_or_404()` (IDOR → 404), `ninja.pagination`
  (`@paginate(StandardPagination)`, `?page=&page_size=` capped at `MAX_PAGE_SIZE`),
  `FilterSchema` filtering (`?status=&q=`), `WriteRateThrottle` on writes, and a Celery
  side-effect claimed atomically (rows-affected UPDATE) on the draft→published transition.
  The publish task calls `external_services.notify_article_published_webhook()` — the
  reference `external_services.py` example (`@handle_api_call_graceful` + httpx, disabled
  when `ARTICLE_PUBLISHED_WEBHOOK_URL` is empty). Endpoints under `/articles`.

Auth/throttle/pagination are all stock Django Ninja — no Knox/DRF/django-ratelimit. Throttle
counters use the Django cache (Redis in prod; in-memory in `local.py` so tests need no Redis).

### Background Tasks
Celery + Redis. Define tasks in `apps/<name>/tasks.py` with `@shared_task`; pass primitive
args and keep them idempotent (broker uses `acks_late`). Celery Beat uses `DatabaseScheduler`.

### Docker
- Dev: `docker-compose.dev.yml` — hot reload, PostgreSQL 18, Redis 8, healthcheck via `/health/live`
- Prod: `docker-compose.prod.yml` — external DB/Redis, `GIT_COMMIT_SHA` build arg injected,
  one-off `migrate` job gates api/worker/beat, json-file log rotation
- Static files are served by whitenoise in every env (manifest storage in prod;
  `collectstatic` runs at image build). No nginx required for static.
- Public exposure: prod compose ships a `cloudflared` (Cloudflare Tunnel) service —
  `TUNNEL_TOKEN` in `.env.prod`, no inbound ports; setup guide in `docs/cloudflare-tunnel.md`.
- TLS terminates at the edge/reverse proxy: set `FORWARDED_ALLOW_IPS` (uvicorn trusts
  `X-Forwarded-*` for scheme + client IP — throttling keys on it) and
  `CSRF_TRUSTED_ORIGINS` in `.env.prod`.

### CI
- `.github/workflows/ci.yml` — ruff format check, lint, mypy, pytest (SQLite), prod Docker build

## Code Style
- Line length: 120
- Ruff rules: `E W F I N UP B C4 SIM S T20 DTZ BLE DJ RUF`
  - `tests`/`conftest` ignore `S101` (assert); `views.py`/`tasks.py` ignore `BLE001`
    (boundary layers may catch-all → log + convert to 500)
- Datetime must be timezone-aware (`USE_TZ=True`) — use `django.utils.timezone.now()` (DTZ enforced)
- Use the loguru `logger`, not stdlib `logging`. 4xx → `logger.warning`, 5xx → `logger.error`
- mypy: `check_untyped_defs` + `strict_equality` on; `migrations/` excluded
- Async views supported — use `sync_to_async` for Django ORM calls
- Test markers: `unit`, `integration`, `slow` (strict markers enforced)
- Shared test fixtures in `conftest.py`

## Project Skills (`.claude/skills/`)
- **scaffold-app** — generate a new layered app (`apps/<name>/`), register it, make migration + tests.
- **add-resource** — add a CRUD resource (schema/service/views) to an existing app.
- **register-admin** — register a new model in Django admin (N+1-safe, masked secrets).
- **check** — run the full local gate: ruff format + lint, mypy, pytest.
- **conventions-review** — review the diff/an app against the layering + best-practice checklist
  (complements the built-in `/code-review`).

## API
- Dev: http://localhost:8000
- Docs: http://localhost:8000/api/docs

## Docs (`docs/`)
- `local-development.md` — 本地開發：env 變數表、日常指令、測試、常見問題
- `deployment.md` — 部署：.env.prod 完整變數表、部署/更新步驟、維運備忘
- `cloudflare-tunnel.md` — Cloudflare Tunnel 設定（含 dashboard 端與 /admin 保護）
