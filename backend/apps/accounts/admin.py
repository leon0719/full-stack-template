from django.contrib import admin

from apps.accounts.models import AuthToken


@admin.register(AuthToken)
class AuthTokenAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "masked_digest", "created_at", "expiry")
    search_fields = ("user__username",)
    list_select_related = ("user",)
    autocomplete_fields = ("user",)
    # Never expose the full digest, and it must not be editable.
    readonly_fields = ("digest", "created_at")
    ordering = ("-created_at",)

    @admin.display(description="digest")
    def masked_digest(self, obj: AuthToken) -> str:
        return f"****{obj.digest[-6:]}" if obj.digest else "--"
