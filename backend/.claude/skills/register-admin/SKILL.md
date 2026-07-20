---
name: register-admin
description: Register a Django model in the admin site whenever a new table/model is added, following this project's admin conventions (N+1-safe list_select_related, search/autocomplete, readonly timestamps, masked secrets). Use when the user adds a model, "新增 table", "建立 model", asks to "show in Django admin", "register admin", "加到 admin", or "make the table visible in admin".
---

# Register a model in Django admin

Whenever a model is added or changed, create/update the app's `admin.py` so the table is
manageable in `/admin/`. Canonical in-repo examples: `apps/articles/admin.py` (FK + status
+ timestamps) and `apps/accounts/admin.py` (masked secret column). Mirror their shape.

## Template

```python
from django.contrib import admin

from apps.<app>.models import <Model>


@admin.register(<Model>)
class <Model>Admin(admin.ModelAdmin):
    list_display = ("id", "<human_field>", "<fk>", "<status>", "created_at")
    list_filter = ("<status>", "created_at")
    search_fields = ("<text_field>", "<fk>__<field>")
    list_select_related = ("<fk>",)        # REQUIRED for every FK shown in list_display
    autocomplete_fields = ("<fk>",)        # FK picker without loading a huge dropdown
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-created_at",)
```

## Rules (project conventions)

- **Register every new model.** Adding a table without an admin entry is incomplete.
- **N+1 rule (most important):** any FK/related object that appears in `list_display`
  MUST be covered by `list_select_related` (or an overridden `get_queryset().select_related(...)`).
  This is the same rule enforced for API list endpoints.
- **`search_fields`:** include the obvious text columns and useful related lookups
  (`owner__username`). Required on the *target* model's admin if another admin references
  it via `autocomplete_fields`.
- **FK fields:** prefer `autocomplete_fields` (needs `search_fields` on the target admin);
  use `raw_id_fields` for very large/un-searchable targets.
- **Timestamps from `TimestampedModel`:** put `created_at` / `updated_at` in `readonly_fields`.
- **Secrets:** never show raw tokens/passwords/keys. Add a masked column via
  `@admin.display` returning `f"****{value[-4:]}"` (see `AuthTokenAdmin.masked_digest`) and
  keep the raw field in `readonly_fields` (or exclude it).
- **`list_filter`:** add for `TextChoices`/status, FKs, and date fields.
- Use the `@admin.register(Model)` decorator (not `admin.site.register(...)` calls).

## After editing

- No migration is needed for admin changes alone (admin isn't a DB concern).
- Viewing requires a superuser: `make createsuperuser`, then `/admin/`.
- Run the `check` skill — `ModelAdmin` misconfig (bad field names in `list_display` /
  `search_fields`) is caught by Django's system checks at startup, which the tests trigger.
