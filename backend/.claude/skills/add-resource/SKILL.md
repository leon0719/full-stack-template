---
name: add-resource
description: Add a CRUD resource (schema + service + endpoints) to an EXISTING Django Ninja app, following this project's layering and auth/ownership/pagination/throttle conventions. Use when the user asks to "add an endpoint", "add a CRUD resource", "加端點", "新增 API", or "expose <model> via the API".
---

# Add a CRUD resource to an existing app

Use when the target app already exists (otherwise use `scaffold-app`). The canonical
reference is `apps/articles` — copy its shape, don't reinvent it.

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
   - Never touch HTTP here; raise `HttpError` for domain failures.

4. **Views** (`views.py`) — thin endpoints on the app's `Router` (keep `auth=BearerAuth()`):
   - `GET /` → `@paginate(StandardPagination)` (from `apps.core.pagination`), returns `list_for_user(request.auth, filters)`
   - `POST /` → `throttle=[WriteRateThrottle()]` (from `apps.core.throttling`), `return Status(201, ...)`
   - `GET/PATCH/DELETE /{int:id}` → fetch via `get_owned_or_404`, delegate to service
   - `DELETE` → `return Status(204, None)`
   - Fire Celery side effects with `task.delay(obj.id)` (primitive args).

5. **Tests** (`tests.py`) — add `@pytest.mark.integration` cases using the `auth_headers` /
   `other_auth_headers` fixtures from `conftest.py`. Always include an **owner-isolation**
   test (another user gets 404) and an **auth-required** test (401 without a token).

## Verify

Run the `check` skill (ruff + mypy + pytest). Owner-isolation and auth tests must pass.
