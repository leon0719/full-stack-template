# Django Ninja Project Tree

A production-ready Django Ninja REST API template with a Celery task queue, PostgreSQL,
Redis, and Docker-based development. Uses [`uv`](https://github.com/astral-sh/uv) as the
package manager and targets Python 3.15+.

## Stack

| Layer        | Technology                                              |
| ------------ | ------------------------------------------------------- |
| Web / API    | Django 6 + Django Ninja (ASGI via Uvicorn)              |
| Serialization| orjson parser/renderer                                  |
| Async tasks  | Celery + Redis broker, Celery Beat (`DatabaseScheduler`)|
| Database     | PostgreSQL 18 (`psycopg` 3, `dj-database-url`)          |
| Settings     | Pydantic Settings reading `.env.{ENV}`                  |
| Logging      | loguru routed through Django logging                    |
| Tooling      | ruff, mypy, pytest, pre-commit                          |

## Quick Start (Docker)

```bash
cp .env.local.example .env.local        # then edit SECRET_KEY etc.
make up                                  # API, DB, Redis, Celery worker + beat
```

- API: http://localhost:8000
- API docs (Swagger): http://localhost:8000/api/docs
- Liveness probe: http://localhost:8000/health/live
- Readiness probe: http://localhost:8000/health/ready

Full guide — env vars, daily commands, testing, troubleshooting:
[docs/local-development.md](docs/local-development.md)

## Common Commands

### Development environment (Docker)

| Command         | Description                                            |
| --------------- | ----------------------------------------------------- |
| `make up`       | Start all dev containers                               |
| `make down`     | Stop containers                                        |
| `make rebuild`  | Rebuild and restart (after Dockerfile/dep changes)    |
| `make logs-api` | Tail API logs (`logs-worker`, `logs-beat`, `logs-db`) |

### Code quality (runs locally)

| Command           | Description                       |
| ----------------- | --------------------------------- |
| `make all`        | Format + lint + type-check        |
| `make format`     | `ruff format .`                   |
| `make lint`       | `ruff check --fix .`              |
| `make type-check` | `mypy .`                          |
| `make unused`     | Find unused functions/classes     |

### Testing (runs in Docker)

| Command                                       | Description       |
| --------------------------------------------- | ----------------- |
| `make test`                                   | Run all tests     |
| `make test TEST=apps/health/tests.py`         | Single file       |
| `uv run pytest -m unit`                       | Only unit tests   |
| `uv run pytest -m "not slow"`                 | Exclude slow tests|

### Dependencies

| Command        | Description                                       |
| -------------- | ------------------------------------------------- |
| `make install` | Install locally (for IDE support)                 |
| `make update`  | Upgrade packages and bump `pyproject.toml` bounds |

### Django management (runs in Docker)

`make migrate` · `make makemigrations` · `make shell` · `make createsuperuser`

## Configuration

Settings live in `config/settings/`:

- `base.py` — Pydantic `Settings` reads `.env.{ENV}`; all env vars flow through the
  `Settings` class (no raw `os.getenv()` in app code).
- `local.py` / `prod.py` — environment-specific overrides (DEBUG, logging format,
  security headers).

Environment is selected with the `ENV` variable (`local` by default), which picks the
`.env.{ENV}` file. Copy `.env.local.example` / `.env.prod.example` as a starting point.

## Production Deployment (single-host Docker Compose)

Step-by-step guide with the full env-var reference:
[docs/deployment.md](docs/deployment.md) (incl. backups/restore and the opt-in CD job) ·
Cloudflare + Caddy setup: [docs/caddy.md](docs/caddy.md) · host nginx instead: [docs/nginx.md](docs/nginx.md)

Bring the stack up with the prod compose file, but get these right first — each one
fails silently or insecurely if skipped:

1. **Set `DJANGO_SETTINGS_MODULE=config.settings.prod`.** The default is
   `config.settings.local` (DEBUG + LocMemCache). Missing it would boot prod in debug
   mode; `local.py` now refuses to load when `ENV=prod`, so this fails loudly instead.

2. **Fill in `.env.prod` and `chmod 600` it.** Copy from `.env.prod.example` and set
   `SECRET_KEY`, `DATABASE_URL`, `CELERY_BROKER_URL`, `CACHE_URL`, etc. Note: secrets
   injected via `env_file` are visible through `docker inspect` to anyone with Docker
   daemon access — fine on a single host you control. For a shared daemon, switch to
   Docker secrets or an external secrets manager.

3. **Get the proxy trust contract right, or per-IP throttling can be bypassed.**
   The per-IP rate limit on `POST /auth/line/exchange` keys on the client IP
   derived from `X-Forwarded-For`. Two settings must agree with your actual topology:
   - `FORWARDED_ALLOW_IPS` — the proxy IP/CIDR uvicorn trusts for `X-Forwarded-*`.
     The example value (`172.16.0.0/12`) matches the shipped caddy service.
   - `NINJA_NUM_PROXIES` — the number of trusted proxy hops (`2` for the shipped
     Cloudflare + Caddy topology; the Caddyfile's `trusted_proxies` covers the
     Cloudflare IP ranges). Set it too low and a direct caller can spoof
     `X-Forwarded-For` to defeat the throttle; too high and a legitimate client
     value is mistaken for the source IP. Recount whenever the topology changes.

   Running your own reverse proxy instead of the bundled Caddy? The API binds to
   `127.0.0.1:8000`, so a same-host proxy works as-is; **if the proxy is on another
   host, firewall port 8000 from the public internet** — anyone reaching uvicorn
   directly can spoof the headers above.

4. **Expose the API via Cloudflare (orange-cloud) + Caddy (shipped default).**
   The prod compose includes a `caddy` service: point a proxied (orange-cloud)
   A record at the host, set Cloudflare SSL mode to **Full**, open inbound 443,
   and set `DOMAIN` in `.env.prod`. Cloudflare terminates the visitor-facing
   TLS; Caddy encrypts the Cloudflare→origin leg with a self-signed cert
   (`tls internal`), so no ACME setup is needed. Full walkthrough (including
   Cloudflare-side settings and protecting `/admin/`):
   [docs/caddy.md](docs/caddy.md). Not using Caddy? Delete the `caddy` service
   and front uvicorn with your own reverse proxy per step 3.

## Project Layout

```
config/            # Project config: settings, urls, celery, logging, exceptions
  settings/        # base.py + local.py / prod.py
  external_api_handler.py   # @handle_api_call(_graceful) — resilient httpx wrappers
apps/
  core/            # Shared Celery tasks + TimestampedModel mixin
  health/          # Health/readiness endpoints
  accounts/        # Example: token auth (LINE login exchange/logout/me) + roles (RBAC)
  articles/        # Example: CRUD + ownership + pagination + throttle + task + xlsx/PDF/zip export + audit
  audit/           # Audit log: LINE login/logout + admin login + business writes (record_audit) + admin changes
  notifications/   # Email + LINE push via an outbox (Celery send, beat retry, abandon → alert) + LINE webhook
  jobs/            # Long-running Celery jobs: progress polling + cancel, owner-scoped
  holidays/        # Taiwan working days (Holiday overrides + import_holidays command)
scripts/           # Dev utilities (version bump, unused-code scan)
docker/            # Dockerfiles + compose files (dev / prod), db_backup/ sidecar, nginx/ site example
```

### Example Endpoints

| Method | Path                                    | Auth   | Notes                                   |
| ------ | ---------------------------------------- | ------ | --------------------------------------- |
| GET    | `/accounts/line/login/`                  | —      | Starts the allauth LINE OAuth flow (redirects to LINE) |
| GET    | `/accounts/line/login/callback/`         | —      | LINE OAuth callback; redirects to the frontend with a one-time exchange code |
| GET    | `/auth/csrf`                             | —      | CSRF token for `X-CSRFToken` (also sets the `csrftoken` cookie) |
| POST   | `/auth/line/exchange`                    | CSRF   | One-time exchange code → HttpOnly auth cookie (no token in the body); rate-limited (10/m/IP) |
| POST   | `/auth/logout`        | Bearer / cookie | Revokes all of the user's tokens, clears the cookie |
| GET    | `/auth/me`            | Bearer | Current user profile + `roles`          |
| GET    | `/articles`           | Bearer | Own articles; `?page=&page_size=&status=&q=` |
| GET    | `/articles/export`    | Bearer | `?format=xlsx\|pdf\|zip` file download, same filters (10/m/user) |
| POST   | `/articles`           | Bearer | Create; rate-limited (30/m/user)        |
| GET    | `/articles/{id}`      | Bearer | Owner-scoped (404 if not owner)         |
| PATCH  | `/articles/{id}`      | Bearer | Partial update; publish fires a task    |
| DELETE | `/articles/{id}`      | Bearer | 200 + empty envelope                    |
| POST   | `/jobs/demo`          | Bearer | Start the demo long-running job         |
| GET    | `/jobs` · `/jobs/{id}` | Bearer | Own jobs; poll status/progress         |
| POST   | `/jobs/{id}/cancel`   | Bearer | Cancel (pending → now; running → next checkpoint) |
| GET    | `/notifications/failed` | Bearer + `admin` role | Undelivered notifications     |
| POST   | `/notifications/line/webhook` | LINE signature | LINE Messaging API webhook      |

Auth uses an opaque token, accepted either as `Authorization: Bearer <token>` or (browsers) in the HttpOnly
auth cookie set by the LINE login exchange above — cookie-authenticated POST/PUT/PATCH/DELETE must also send
`X-CSRFToken` from `GET /auth/csrf` (403 `csrf_failed` otherwise). There is no username/password login and no
endpoint that returns a token in a response body (tests mint one with `AuthService.issue_token`).

See [`CLAUDE.md`](./CLAUDE.md) for architecture details, app layering conventions, and
the checklist for adding a new app.

## Conventions

- **Line length** 120; ruff rule set `E W F I N UP B C4 SIM S T20 DTZ BLE DJ RUF`.
- **Logging**: import the loguru `logger`; do not use the stdlib `logging` module
  directly. Map 4xx → `logger.warning`, 5xx → `logger.error`.
- **Datetime**: always timezone-aware (`USE_TZ=True`); use `django.utils.timezone.now()`.
- **Blind `except Exception`** is allowed only in boundary layers (`views.py`, `tasks.py`)
  and must log + convert to a proper HTTP error.
- **Test markers**: `unit`, `integration`, `slow` (strict markers enforced).

## Version trade-offs

- **Django 6.1** — current default, not an LTS. For a set-and-forget baseline, pin to **5.2 LTS**
  (supported until ~2028-04) instead.
- **django-celery-beat cap overridden** — django-celery-beat 2.9.0 (latest on PyPI) pins `django<6.1`,
  though its main branch already supports and CI-tests Django 6.1 + Python 3.15.
  `[tool.uv] override-dependencies` in `pyproject.toml` lifts the cap; delete it once
  django-celery-beat >= 2.10 ships (celery/django-celery-beat#1079).
- **Python 3.15** — Django 6.1 supports it officially; Celery 5.7 only declares up to 3.14
  (test suite passes on 3.15). Re-check when upgrading Celery or Python.
