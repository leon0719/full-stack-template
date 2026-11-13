from django.contrib import admin

from apps.audit.admin import AuditedAdminMixin
from apps.holidays.models import Holiday


@admin.register(Holiday)
class HolidayAdmin(AuditedAdminMixin, admin.ModelAdmin):
    list_display = ("day", "name", "is_holiday", "updated_at")
    list_filter = ("is_holiday",)
    search_fields = ("name",)
    date_hierarchy = "day"
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-day",)
