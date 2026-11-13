from django.contrib import admin
from django.http import HttpRequest

from apps.audit.admin import AuditedAdminMixin
from apps.jobs.models import Job


@admin.register(Job)
class JobAdmin(AuditedAdminMixin, admin.ModelAdmin):
    list_display = ("id", "kind", "owner", "status", "progress", "started_at", "finished_at", "created_at")
    list_filter = ("status", "kind", "created_at")
    search_fields = ("kind", "celery_task_id", "owner__username")
    list_select_related = ("owner",)
    ordering = ("-created_at",)

    # Job 狀態只由 task 與 API 推進;後台只看不改(要取消請走 API,才會同時 revoke + 設旗標)。
    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: Job | None = None) -> bool:
        return False
