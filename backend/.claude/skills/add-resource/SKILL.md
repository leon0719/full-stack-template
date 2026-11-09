---
name: add-resource
description: Add a CRUD resource (schema + service + endpoints) to an EXISTING Django Ninja app, following this project's layering and auth/ownership/pagination/throttle conventions. Use when the user asks to "add an endpoint", "add a CRUD resource", "加端點", "新增 API", or "expose <model> via the API".
---

# Add a CRUD resource to an existing app

Use when the target app already exists (otherwise use `scaffold-app`). The canonical
reference is `apps/articles` — copy its shape, don't reinvent it.

Build **inside-out** and don't start the next layer until the current layer's tests pass:
model → schema → service (+ tests) → views (+ tests). Starting from the views hides
service bugs behind HTTP noise.

If a convention is unclear (field naming, which throttle, owner-scoped or not), **ask
first**, then apply the answer to every file at once — don't invent a rule per file.

## Steps

1. **Model** (`models.py`) — if the resource needs a new table: inherit
   `apps.core.models.TimestampedModel`; set explicit `on_delete` + `related_name`; add a
   `Meta.indexes` entry for the query path you'll actually use (usually
   `Index(fields=["owner", "-created_at"])`). Then `make makemigrations-local APP=<app>`.
   **New table → also register it in `admin.py`** (use the **register-admin** skill).

2. **Schema** (`schema.py`) — add `*CreateRequest`, `*UpdateRequest` (all fields optional),
   `*Response`, and a `*Filter(FilterSchema)`. `*Response` should inherit
   `apps.core.schema.TimestampedSchema` (it supplies `created_at` / `updated_at`) and add only
   the resource's own fields. Use `Field(...)` constraints (min/max length, `Literal[...]` for
   enums). Filter lookups: `Annotated[str | None, FilterLookup(q="title__icontains")]`.

3. **Service** (`services.py`) — subclass `apps.core.services.OwnedResourceService[<Model>]`:
   - Declare `model = <Model>` and `select_related = (...)` for the list query.
   - Inherited from the base (do NOT re-implement): `get_owned_or_404(user, pk)` (IDOR → 404),
     `owned_qs(user)`, `create(user, payload)`, `update(obj, payload)`, `delete(obj)`.
   - Add only resource-specific methods, e.g. `list_for_user(user, filters)` →
     `filters.filter(cls.owned_qs(user))`, or override `create`/`update` for field transforms.
   - Never touch HTTP here; raise `AppError(status, ErrorCode.X, msg)` for client-branchable failures (add the
     code to `config/errors.py`), plain `HttpError` otherwise.
   - **Gate:** write service tests for every resource-specific method and each `AppError`/`HttpError`
     branch, then `make test-local TEST=apps/<app>/tests.py` must pass before step 4.

4. **Views** (`views.py`) — thin endpoints on the app's `Router` (keep `auth=BearerAuth()`):
   - Every endpoint: `response=BaseResponse[XxxResponse]`, `return BaseResponse(data=...)` (`apps.core.schema`)
   - `GET /` → `response=BaseResponse[Page[XxxResponse]]`, param `page: StandardPagination.Input = Query(...)`,
     `return BaseResponse(data=StandardPagination().paginate_queryset(qs, page, request))` — no `@paginate`
   - `POST /` → `throttle=[WriteRateThrottle()]` (from `apps.core.throttling`), `return Status(201, BaseResponse(data=...))`
   - `GET/PATCH/DELETE /{int:id}` → fetch via `get_owned_or_404`, delegate to service
   - `DELETE` → `response=BaseResponse[None]`, `return BaseResponse()` (200, not 204)
   - Fire Celery side effects with `transaction.on_commit(lambda: task.delay(obj.id), robust=True)`
     (primitive args; see `apps/articles/views.py`).

5. **Endpoint tests** (`tests.py`) — `@pytest.mark.integration` cases using the `auth_headers` /
   `other_auth_headers` fixtures from `conftest.py`. Always include an **owner-isolation**
   test (another user gets 404) and an **auth-required** test (401 without a token). For
   writes, assert the status code **and** re-read the row from the DB.

## Done checklist

Report every item with one of three states — never tick what you didn't actually run:
`[x]` verified · `[ ]` not done · `[ ] ⛔ <reason>` couldn't verify (e.g. Docker not running).

- [ ] Migration generated and committed; `makemigrations --check` would be clean
- [ ] New model registered in `admin.py`
- [ ] Service tests pass (before views were written)
- [ ] Endpoint tests pass, incl. owner-isolation (404) and auth-required (401)
- [ ] List endpoint paginated; writes throttled
- [ ] No ORM / business logic in `views.py`
- [ ] `check` skill passes (ruff + mypy + pytest)

## Common pitfalls

- `get_owned_or_404` inside a broad `try/except Exception` swallows the 404 into a 500.
- `return 201, body` tuples are deprecated — use `Status(201, body)`.
- Passing a model instance to `task.delay()` — pass the id; tasks re-fetch.
- Calling `task.delay()` directly instead of via `transaction.on_commit(...)`: the worker can
  run before the commit and not see the row. Tests then need `django_capture_on_commit_callbacks`
  (see `apps/articles/tests.py`) or the task never fires.
- New `NOT NULL` column on an existing table in one migration — prod runs `migrate` while old
  code still serves traffic. Go nullable → backfill → add the constraint.
- Bare `uv run pytest` fails on a fresh clone (no `SECRET_KEY`/`DATABASE_URL`) — use `make test-local`.
