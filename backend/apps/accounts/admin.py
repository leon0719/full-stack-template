from django.contrib import admin
from django.contrib.auth.admin import GroupAdmin as DjangoGroupAdmin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.contrib.auth.models import Group, User

from apps.accounts.models import AuthToken, LineProfile
from apps.audit.admin import AuditedAdminMixin

# 換掉 Django 內建的 User / Group admin,只為了加上稽核:角色 = group(apps/accounts/roles.py),
# 在後台改某人的 group、is_superuser、is_active 都是權限變更,必須留下紀錄。
admin.site.unregister(User)
admin.site.unregister(Group)


@admin.register(User)
class UserAdmin(AuditedAdminMixin, DjangoUserAdmin):
    pass


@admin.register(Group)
class GroupAdmin(AuditedAdminMixin, DjangoGroupAdmin):
    pass


@admin.register(AuthToken)
class AuthTokenAdmin(AuditedAdminMixin, admin.ModelAdmin):
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
class LineProfileAdmin(AuditedAdminMixin, admin.ModelAdmin):
    list_display = ("id", "user", "display_name", "line_user_id", "updated_at")
    search_fields = ("user__username", "display_name", "line_user_id")
    list_select_related = ("user",)
    autocomplete_fields = ("user",)
    readonly_fields = ("line_user_id", "updated_at")
    ordering = ("-updated_at",)
