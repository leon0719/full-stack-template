from django.contrib import admin, messages
from django.db.models import QuerySet
from django.http import HttpRequest

from apps.audit.admin import AuditedAdminMixin
from apps.notifications.models import Notification
from apps.notifications.services import NotificationService


@admin.register(Notification)
class NotificationAdmin(AuditedAdminMixin, admin.ModelAdmin):
    list_display = ("id", "channel", "recipient", "source", "retry_count", "sent_at", "abandoned_at", "created_at")
    list_filter = ("channel", "sent_at", "abandoned_at", "created_at")
    search_fields = ("recipient", "source", "user__username")
    list_select_related = ("user",)
    autocomplete_fields = ("user",)
    # outbox 是發送紀錄,不是可編輯的資料:狀態只能由發送流程或下方 action 改。
    readonly_fields = (
        "channel",
        "recipient",
        "payload",
        "user",
        "source",
        "idempotency_key",
        "retry_count",
        "last_error",
        "locked_until",
        "sent_at",
        "abandoned_at",
        "created_at",
        "updated_at",
    )
    ordering = ("-created_at",)
    actions = ("retry_now",)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    @admin.action(description="重新發送(清除放棄狀態與重試次數)")
    def retry_now(self, request: HttpRequest, queryset: QuerySet[Notification]) -> None:
        ids = list(queryset.filter(sent_at__isnull=True).values_list("pk", flat=True))
        for notification_id in ids:
            NotificationService.retry(notification_id)
        self.message_user(request, f"已重新排入 {len(ids)} 則未送出的通知。", messages.SUCCESS)
