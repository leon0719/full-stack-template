from django.contrib import admin

from apps.accounts.models import AuthToken, LineProfile


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


@admin.register(LineProfile)
class LineProfileAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "display_name", "line_user_id", "updated_at")
    search_fields = ("user__username", "display_name", "line_user_id")
    list_select_related = ("user",)
    autocomplete_fields = ("user",)
    readonly_fields = ("line_user_id", "updated_at")
    ordering = ("-updated_at",)
