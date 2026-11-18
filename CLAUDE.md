# CLAUDE.md

Full-stack monorepo template: `backend/` (Django Ninja + Celery, uv + Docker) and
`frontend/` (Vite + React 19 + FSD, bun + Biome).

This file holds the rules shared by both halves. When working inside a subdirectory, its own
CLAUDE.md adds the stack-specific rules:

- Backend (layering, settings, tests, Docker) → [backend/CLAUDE.md](backend/CLAUDE.md)
- Frontend (FSD import rules, TDD, platform primitives) → [frontend/CLAUDE.md](frontend/CLAUDE.md)

## Response language

Always reply in Traditional Chinese (繁體中文) with Taiwan-localized wording, even when asked in English —
use 程式碼／資料／函式／物件／介面／型別／快取／預設／效能, never 代碼／數據／函數／對象／接口／類型／緩存／默認／性能.
Code identifiers, file names, directory names, and package names stay in English.

## Human-only operations ⛔

Never run these yourself — stop and hand the exact command to the user
(`.claude/settings.json` and `.claude/hooks/block-human-only.sh` also block them):
- `make deploy-frontend` / `scripts/deploy-frontend.sh`, any `aws` command
- Anything touching prod: `make prod-*`, `backend/docker/docker-compose.prod.yml`, `.env.prod`,
  connecting to a prod DB/Redis
- `git push` (any branch), force-push, rewriting published history
- `make docker-clean` (wipes the local DB volume)
- Deleting or rewriting migrations that may already be applied anywhere
- Calling real third-party APIs (incl. real LINE Login), sending real email

## Top-level commands

- `make up` / `make down` / `make logs` / `make migrate` — backend Docker
- `make dev` — frontend dev server
- `make gen-api` — backend OpenAPI → `frontend/src/shared/api/schema.d.ts` (backend need not be running).
  Run it and commit the output whenever a backend schema/endpoint changes; frontend `tsc` then points at
  everything that must follow.
- `make check` — every quality check for both halves (= `check-backend` + `check-frontend`)

## Integration layer (what this repo adds on top of the two upstream templates)

- **Auth**: LINE Login only, no username/password. The backend uses django-allauth's LINE provider
  (`SOCIALACCOUNT_ONLY=True`) for the OAuth exchange; a custom adapter (`backend/apps/accounts/adapters.py`)
  turns the login into the existing opaque token, stores it behind a one-time exchange code
  (60 s TTL), and redirects to the frontend `/login/callback?code=...`. The frontend
  `django-adapter.ts` `completeLineLogin(code)` calls `POST /auth/line/exchange` (with `X-CSRFToken` from
  `GET /auth/csrf`), which sets the token as an HttpOnly cookie (`__Host-auth` in prod, `auth` locally) —
  the browser never sees it — then `GET /auth/me`. Bearer is kept for tests only; no
  endpoint hands out a Bearer token. `main.tsx` calls `setAuthAdapter(djangoAuthAdapter)` at startup.
  Frontend and API must share a parent domain in prod (SameSite=Lax cookie). Testing the LINE callback
  locally needs public HTTPS — see the cloudflared section of `docs/development.md`.
- **Roles (RBAC)**: backend roles are Django Groups (`backend/apps/accounts/roles.py`: every active user has
  `user`, `is_superuser` implies `admin`, other roles = groups named in `Role`). `GET /auth/me` returns
  `roles`; `django-adapter.ts` maps them 1:1 into `User.roles` (and `id` number → string), so the frontend
  `<RequireRole>` / `usePermission()` see exactly the backend's roles. The backend `Role` enum and the
  frontend `shared/auth` `Role` type must match — add a role on both sides + a group data migration, then
  `make gen-api`. Frontend role checks only hide UI; the backend `require_role()` is the real gate (403 `permission_denied`).
- **LINE Login vs LINE push**: two different LINE channels. Login = `LINE_LOGIN_*` (allauth, stores the
  LINE userId in `LineProfile`); push/webhook = Messaging API `LINE_MESSAGING_*` (`apps/notifications`).
  `NotificationService.enqueue_line_to_user(user, ...)` pushes to a logged-in user via `LineProfile`, which
  only works when **both channels live under the same LINE provider** (userIds are per-provider) and the user
  has added the official account as a friend.
- **Long-running jobs**: backend `apps/jobs` ↔ frontend `useJobPolling`. `POST <start endpoint>` → 201 + job;
  poll `GET /jobs/{id}` → `{id, status, progress, result, error}` (`status` ∈ pending/running/succeeded/failed/
  cancelled, `progress` 0–100|null, `error` = stable code usable as i18n key); `POST /jobs/{id}/cancel`
  (finished → 409 `job_not_cancellable`). Another user's job → 404. `id` is a number (`JobId = string | number`).
- **File downloads**: export endpoints (e.g. `GET /articles/export`) return the raw file, not `BaseResponse`;
  the frontend uses `apiDownload()` and needs `Content-Disposition`, which the backend exposes via
  `CORS_EXPOSE_HEADERS` (cross-origin in dev and prod).
- **Not wired yet**: the frontend `useEventStream` (SSE) has no backend counterpart — no SSE / stream-token
  endpoint in this repo's backend. Add both before using it.
- **Dev wiring**: frontend `.env.development` sets `VITE_API_BASE_URL=http://localhost:8000` (cross-origin,
  same site, so the cookie works; requests carry `credentials: "include"` + `X-CSRFToken`); backend dev
  CORS allows 5173 by default — change the port on both sides together. LINE tunnel mode points
  cloudflared at Vite (5173) instead and sets `VITE_API_BASE_URL=` (same origin): `vite.config.ts`
  `server.proxy` forwards the backend paths to `localhost:8000`. `CORS_ALLOWED_ORIGINS` also feeds
  `CSRF_TRUSTED_ORIGINS`.
- **CI/CD**: `.github/workflows/{backend,frontend}-ci.yml`, each with its own `paths` filter; no workflows
  in the subdirectories. `backend-ci.yml` also has an opt-in `deploy` job (only when repo variable
  `DEPLOY_ENABLED=='true'`; SSH → fast-forward to the CI-verified SHA → `make prod-backup/build/migrate/up`
  in `backend/`) — see `backend/docs/deployment.md`. The frontend is still deployed by hand (`make deploy-frontend`).
- **Docs**: `docs/development.md`, `docs/deployment.md`. Backend deployment detail lives in
  `backend/docs/`; top-level docs cover only the integration layer.

## Frontend–backend contract

- Every response is a `BaseResponse`: success `{"data": <T>, "error": null}`, failure
  `{"data": null, "error": {"code": <HTTP status>, "message", "reason"}}`. Only exception: successful file
  downloads (raw file + `Content-Disposition`; their errors still use the envelope).
- The frontend `shared/api` client unwraps `data` automatically; branch on `ApiError.reason`
  (the backend `ErrorCode` in `config/errors.py`), never on `message`.
- Frontend types come only from the `schema.d.ts` generated by `make gen-api`; never hand-write backend types.

## Change rules

- Do not restructure the inside of either sub-template; integration code goes at the top level or
  into the existing extension points (adapter, env, compose).
- Backend auth endpoint changes affect `django-adapter.ts` (schemas in `backend/apps/accounts/schema.py`) —
  change both sides together and run `make gen-api`.

## Git

- Commit format `<type>: <description in Chinese>`; type is one of `feat` / `fix` / `docs` / `style` /
  `refactor` / `test` / `chore`. The description is written in Chinese. No scope (never `feat(frontend):`;
  when both halves change, say so in the description).
- Breaking change (callers break unless they change code): add `!` after the type — `feat!: /auth/me 移除 email 欄位`.
- Branch `<type>/<description>`, type one of `feat` / `fix` / `refactor` / `docs` / `chore`;
  never commit directly to `main`.
