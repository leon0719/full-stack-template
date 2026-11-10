# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 回應語言

**一律使用繁體中文，採台灣本地化用語**——用 程式碼／資料／函式／物件／介面／型別／快取／預設／效能，
不用 代碼／數據／函數／對象／接口／類型／緩存／默認／性能。即使以英文提問，回應仍用繁體中文。
程式碼識別字、檔名、目錄名、套件名保持英文不翻譯。

## Human-only operations ⛔

Never run these yourself — stop and hand the exact command to the user:
- Anything touching prod: `make prod-*`, `docker-compose.prod.yml`, connecting to a prod DB/Redis
- `git push` (any branch), force-push, rewriting published history
- Calling real third-party endpoints / webhooks (incl. real LINE Login), sending real email
- Deleting or rewriting migrations that may already be applied anywhere

## Project Overview

Django Ninja REST API template with Celery task queue, PostgreSQL, Redis, and Docker-based development. Uses `uv` as the package manager, Python 3.15+.

### Version trade-offs
- **Django 6.1** — current default. Not an LTS; for a set-and-forget baseline, pin to
  **5.2 LTS** (supported until ~2028-04) instead.
- **django-celery-beat cap overridden** — django-celery-beat 2.9.0 (latest on PyPI) pins
  `django<6.1`, though its main branch already supports and CI-tests Django 6.1 + Python 3.15.
  `[tool.uv] override-dependencies` in `pyproject.toml` lifts the cap; delete it once
  django-celery-beat >= 2.10 ships (celery/django-celery-beat#1079).
- **Python 3.15** — Django 6.1 supports it officially; Celery 5.7 only declares up to 3.14
  (test suite passes on 3.15). Re-check when upgrading Celery or Python.

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
- `make test-local` — Fastest feedback: all tests locally on in-memory SQLite (no Docker needed)
- `uv run pytest -m unit` — Run only unit tests (locally)
- `uv run pytest -m "not slow"` — Exclude slow tests

> `make type-check` / `test-local` / `makemigrations-local` load `.env.local` if present
> and otherwise inject dummy `SECRET_KEY`/`DATABASE_URL`, because `config.settings.local`
> instantiates the pydantic `Settings()` at import. `test-local` forces
> `DATABASE_URL=sqlite://:memory:` (override with `TEST_DATABASE_URL`).

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
- **Responses** (team contract, same as the FastAPI/.NET backends and the frontend `shared/api` client):
  success `{"data": <T>, "error": null}`, failure `{"data": null, "error": {"code": <HTTP status>, "message", "reason"}}`.
  Endpoints declare `response=BaseResponse[XxxResponse]` and `return BaseResponse(data=...)` (`apps/core/schema.py`);
  delete → 200 + `BaseResponse()`, not 204. `/` and `/health/*` are probes, not wrapped. Lists: no `@paginate`
  (its output can't be wrapped) — `page: StandardPagination.Input = Query(...)` +
  `BaseResponse(data=StandardPagination().paginate_queryset(qs, page, request))` → `data: {items, count}`.
- **Errors**: raise `AppError(status, ErrorCode.X, message)` (`config/errors.py`; client-branchable, becomes
  `error.reason`) or plain `HttpError` (`reason: null`); `exceptions.py` renders the envelope and logs 500s via
  `logger.exception()`. Never hand-build an error response.
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
- **services.py** — business logic. Stateless; raises `AppError`/`HttpError`; no `httpx`.
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
- **`apps/accounts`** — token auth/authz. Login is LINE-only (django-allauth
  `socialaccount` provider, no username/password): `GET /accounts/line/login/` +
  `GET /accounts/line/login/callback/` (allauth-owned) redirect back to the
  frontend with a one-time exchange code, which `POST /auth/line/exchange`
  (IP rate-limited via `apps.core.throttling.LoginThrottle`, an
  `ninja.throttling.AnonRateThrottle`) trades for an opaque bearer token
  (`secrets` + SHA-256 digest stored, raw token shown once). Custom adapters
  in `adapters.py` wire allauth's OAuth client into this token system.
  `authentication.BearerAuth` (a ninja `HttpBearer`) sets `request.auth`/`request.user`
  for `POST /auth/logout`, `GET /auth/me`.
- **`apps/articles`** — CRUD resource showing the full stack: router-level `auth=BearerAuth()`,
  owner-scoped queries with `get_owned_or_404()` (IDOR → 404), `StandardPagination` inside
  `BaseResponse` (`?page=&page_size=` capped at `MAX_PAGE_SIZE`),
  `FilterSchema` filtering (`?status=&q=`), `WriteRateThrottle` on writes, and a Celery
  side-effect claimed atomically (rows-affected UPDATE) on the draft→published transition.
  The publish task calls `external_services.notify_article_published_webhook()` — the
  reference `external_services.py` example (`@handle_api_call_graceful` + httpx, disabled
  when `ARTICLE_PUBLISHED_WEBHOOK_URL` is empty). Endpoints under `/articles`.

Auth/throttle/paginator classes are all stock Django Ninja — no Knox/DRF/django-ratelimit. Throttle
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
- Public exposure: Cloudflare orange-cloud → bundled `caddy` service (`tls
  internal` self-signed origin cert, Cloudflare SSL mode Full, `trusted_proxies`
  = Cloudflare IPs, `NINJA_NUM_PROXIES=2`) — `DOMAIN` in `.env.prod`, host opens
  inbound 443, Caddyfile at `docker/Caddyfile`; setup guide in `docs/caddy.md`.
- TLS terminates at the edge/reverse proxy: set `FORWARDED_ALLOW_IPS` (uvicorn trusts
  `X-Forwarded-*` for scheme + client IP — throttling keys on it) and
  `CSRF_TRUSTED_ORIGINS` in `.env.prod`.

### CI
- `.github/workflows/backend-ci.yml` (repo root) — ruff format check, lint, mypy, pytest (SQLite), prod Docker build
- Prod env for CI (`check --deploy` + docker smoke test) lives only in `backend/.env.ci` (fake values,
  committed). Adding a required prod setting → add a fake value there and document it in `.env.prod.example`;
  `config/test_ci_env.py` fails `make test-local` until both are done.

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

## Git

- Commit 格式 `<type>: <中文說明>`，type 只有 `feat`／`fix`／`docs`／`style`／`refactor`／`test`／`chore`。
  **說明用中文**、**不使用 scope**（不寫 `feat(auth):`）。
- 破壞性變更（呼叫端不改程式就會壞）在 type 後加 `!`：`feat!: 移除 GET /articles 的 status 欄位`。
- 分支 `<類型>/<描述>`，類型只有 `feat`／`fix`／`refactor`／`docs`／`chore`；不直接 commit 到 `main`。

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
- `caddy.md` — Cloudflare 橘雲 + Caddy 設定（含 SSL mode、真實 client IP 與 /admin 保護）
- `alerting.md` — 告警：Sentry→Slack alert rule、health 端點監控、beat 心跳、
  佇列積壓、CI 失敗通知（含上線檢查清單）
- `api-standards.md` / `backend-standards.md` / `integration-standards.md` — 新增/修改
  端點、app、第三方整合前先看：API 設計、架構/DB/機密、Celery/快取/SSE/WebSocket/Webhook
  的慣例 checklist + 目前遵守狀態（源自上游 `django-ninja-backend-template`，已依本專案
  現況調整——例如 SSE/WebSocket/效能測試段落標成未實作，因為本專案未引入 `apps/realtime`
  / `perf/`）

### Alerting (`config/alerting.py` + `apps/core/tasks.py`)
Sentry 只看得到「跑了而且丟出例外」的程式碼。壞掉卻安靜的故障（beat 死掉、
worker 沒起來、佇列積壓）不會產生任何 Sentry 事件，得靠外部訊號偵測：
- `BEAT_HEARTBEAT_URL` — beat 每 5 分鐘 ping 外部監控；ping 停止即代表 beat 掛了
- `CELERY_QUEUE_DEPTH_ALERT_THRESHOLD` — 直接問 broker 佇列長度（不是 `celery
  inspect`，因為 worker 全掛時 inspect 也問不到），超標送 Sentry
- `task_failure` / `task_retry` signal — 補結構化 log，供 log-based 告警使用
- `ENV=prod` 時 `SENTRY_DSN` 為**必填**，留空拒絕開機；不用請顯式填 `disabled`
