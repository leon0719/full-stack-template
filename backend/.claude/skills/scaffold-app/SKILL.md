---
name: scaffold-app
description: Scaffold a new Django Ninja app following this project's layered conventions. Use when the user asks to "create a new app", "開新 app", "scaffold app", "add an app", or "新增模組". Generates apps/<name>/ with the full layer set, registers it in INSTALLED_APPS and urls, and produces a migration + tests.
---

# Scaffold a new app

Create a new app under `apps/<name>/` that mirrors `apps/articles` (the canonical
layered example). Ask the user for the app name and, if relevant, the main model's
fields before generating.

## Layer files to create

```
apps/<name>/
  __init__.py            # empty
  apps.py                # AppConfig: name="apps.<name>", verbose_name="<Name>"
  models.py              # ORM models; inherit apps.core.models.TimestampedModel for created/updated
  admin.py               # register every model in Django admin (see register-admin skill)
  schema.py              # ninja Schema request/response + FilterSchema; *Response inherits apps.core.schema.TimestampedSchema
  services.py            # <Resource>Service(OwnedResourceService[<Model>]) from apps.core.services; declare model + select_related
  views.py               # Router(tags=[...], auth=BearerAuth()); thin — delegate to services
  tasks.py               # @shared_task, primitive args, idempotent (only if needed)
  external_services.py   # only place httpx lives; wrap with @handle_api_call(_graceful) (only if needed)
  migrations/__init__.py # empty
  tests.py               # @pytest.mark.unit (schema/pure) + @pytest.mark.integration (DB/endpoints)
```

Skip `tasks.py` / `external_services.py` if the app needs no background work or outbound calls.

## Conventions to follow (match apps/articles exactly)

- **Auth**: protect endpoints with `auth=BearerAuth()` from `apps.accounts.authentication`
  (router-level for "all endpoints", or per-operation). Access the user via `request.auth`.
  Token crypto helpers live in `apps.core.security` (`hash_token` / `generate_token`).
- **Ownership / IDOR**: subclass `apps.core.services.OwnedResourceService` — its
  `get_owned_or_404(user, pk)` / `owned_qs(user)` give owner-scoped, IDOR-safe access
  (non-owners get 404, never 403/200). Don't hand-roll the lookup.
- **Pagination**: `@paginate(StandardPagination)` from `apps.core.pagination` on list endpoints
  (settings-driven default page size + cap). Don't use bare `PageNumberPagination`.
- **Filtering**: `FilterSchema` with `Annotated[..., FilterLookup(q="field__icontains")]`.
- **Rate limit**: use the semantic throttles in `apps.core.throttling`
  (`WriteRateThrottle` on authenticated writes, `LoginThrottle` / `RegisterThrottle` on
  unauthenticated auth endpoints) — never inline rate strings. Rates live in `Settings`.
- **Shared schema**: reuse `apps.core.schema.DetailResponse` for `{"detail": "..."}` bodies.
- **Status codes**: return `Status(code, body)` from `ninja.responses` (not a `(code, body)` tuple).
- **Logging**: loguru `logger`, format `[Layer] message - key: value`; 4xx → warning, 5xx → error.
- **Models**: explicit `on_delete` + `related_name`; add `Meta.indexes` for real query paths
  (e.g. `Index(fields=["owner", "-created_at"])`).

## Wire-up steps (do all of these)

1. Add `"apps.<name>",` to `INSTALLED_APPS` in `config/settings/base.py`.
1. Register each model in `admin.py` (use the **register-admin** skill — N+1-safe
   `list_select_related`, search/autocomplete, readonly timestamps, masked secrets).
2. Import the router in `config/urls.py` and register it:
   `api.add_router("/<name>", <name>_router)`.
3. Generate the migration (loads .env.local or dummy env):
   `make makemigrations-local APP=<name>`
   (or `SECRET_KEY=dummy DATABASE_URL="postgresql://u:p@localhost:5432/db" uv run python manage.py makemigrations <name>`).
4. Add shared fixtures to root `conftest.py` only if broadly reused.

## Verify before finishing

Run the `check` skill, or at minimum:

```bash
uv run ruff check . && uv run ruff format --check .
make type-check
SECRET_KEY=dummy DATABASE_URL="sqlite://:memory:" uv run pytest -q
```

All three must pass. Integration tests run against in-memory SQLite locally; the real
DB is Postgres in Docker (`make test`).
