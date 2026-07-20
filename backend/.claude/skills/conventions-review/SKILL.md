---
name: conventions-review
description: Review the current diff (or a named app) against THIS project's layering conventions and backend best-practice checklist — auth/IDOR, N+1, migrations, Celery idempotency, logging, error format, throttle/pagination. Use when the user asks to "review", "code review", "審查", "check conventions", or "review my app/PR". Complements the built-in /code-review (which hunts general bugs) by enforcing project-specific rules.
---

# Conventions & best-practice review

Review scope: by default the working diff (`git diff` + untracked files). If the user
names an app, review `apps/<name>/`. Read the changed files, then check each item below.
Report findings grouped by severity (Blocker / Should-fix / Nit) with `file:line` refs.
Don't restate things that are fine — only flag gaps. For confirmed correctness bugs,
suggest also running the built-in `/code-review`.

## Layering (apps/articles is the reference)

- [ ] `views.py` is thin — HTTP only, delegates to a service. No ORM/business logic in views.
- [ ] Business logic lives in `services.py`; raises `HttpError`, never returns HTTP responses.
- [ ] `httpx` appears ONLY in `external_services.py`, wrapped with
      `@handle_api_call` / `@handle_api_call_graceful` (no bare `httpx` in services/views).
- [ ] Request/response shapes are in `schema.py` (`*Request` / `*Response` naming).

## Auth & authorization

- [ ] Non-public endpoints set `auth=BearerAuth()` (router- or operation-level).
- [ ] Object lookups are owner-scoped via `get_owned_or_404` (IDOR → 404). No
      `Model.objects.get(pk=...)` without an ownership filter on user-facing reads/writes.
- [ ] `get_object_or_404` / ownership fetch is OUTSIDE any broad `try/except` (so a 404
      isn't swallowed into a 500).

## Database

- [ ] List/iteration paths avoid N+1: `select_related` (FK) / `prefetch_related` (M2M/reverse).
- [ ] New non-null columns have a `default` (or a 3-step nullable→backfill→non-null migration).
- [ ] FKs declare explicit `on_delete` + `related_name`; indexes match real query paths.
- [ ] Migration committed and `makemigrations --check` would be clean.
- [ ] New model is registered in `admin.py`; every FK in `list_display` has
      `list_select_related` (admin N+1), timestamps are `readonly_fields`, secrets masked.

## Async tasks / external calls

- [ ] Celery tasks take primitive args (ids, not model instances) and are idempotent.
- [ ] Side effects after a DB write use `transaction.on_commit(...)` where ordering matters.
- [ ] Outbound calls have timeouts and go through the handler decorators.

## API surface

- [ ] Pagination on list endpoints (`@paginate`); writes carry a sensible throttle.
- [ ] Returns `Status(code, body)` (not deprecated `(code, body)` tuples).
- [ ] Correct status codes (201 create, 204 delete, 401 vs 403 vs 404, 422 validation).

## Logging & errors

- [ ] Uses loguru `logger` (not stdlib `logging`); 4xx → `warning`, 5xx → `error`.
- [ ] No secrets/tokens/passwords in logs.
- [ ] No blind `except Exception` outside boundary layers (`views.py` / `tasks.py`), and
      even there it logs + converts to a proper error.

## Tooling

- [ ] `make type-check`, `ruff check`, and `pytest` pass (run the `check` skill).
- [ ] No blanket `# noqa` / `# type: ignore` — targeted ignores only, with a reason.
- [ ] Tests include owner-isolation and auth-required cases for new endpoints.
