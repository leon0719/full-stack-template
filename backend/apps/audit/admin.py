from typing import Any

from django.contrib import admin
from django.db import models
from django.db.models import QuerySet
from django.forms import ModelForm
from django.http import HttpRequest

from apps.audit.models import AuditLog
from apps.audit.services import record_audit, snapshot


def _m2m_snapshot(obj: models.Model) -> dict[str, list[Any]]:
    """多對多欄位(例如 User.groups = 角色)的 pk 清單,排序後才比得出差異。"""
    if obj.pk is None:
        return {}
    return {
        field.name: sorted(getattr(obj, field.name).values_list("pk", flat=True)) for field in obj._meta.many_to_many
    }


class AuditedAdminMixin(admin.ModelAdmin):
    """Django admin 對這個 model 的新增/修改/刪除都留一筆 ``AuditLog``(admin_add / admin_change / admin_delete)。

    用法:``class XxxAdmin(AuditedAdminMixin, admin.ModelAdmin)``(mixin 放最左邊)。

    - 寫入點是 ``save_related`` / ``delete_model`` / ``delete_queryset``:admin 的 changeform、
      list_editable、批次刪除都會經過,而且都在 admin 自己的 ``transaction.atomic()`` 裡——
      稽核與異動同一個交易,寫稽核失敗整個異動一起回滾,不會「改了但沒留紀錄」。
    - 舊值在 ``save_model`` 呼叫 super() **之前**從 DB 重新讀(form 已經把新值寫進 obj 了),
      多對多欄位(角色 group 等)在 ``save_related`` 前後各取一次,所以改角色也會被記到。
    - 欄位 diff 走 ``apps.audit.services``:機密欄位(password 等)只記「有變更」。
    - 子類別覆寫 ``save_model`` / ``save_related`` / ``delete_model`` / ``delete_queryset`` 時
      務必呼叫 ``super()``,否則該路徑會默默漏記。
    - 不經過這幾個 hook 的路徑不會記:admin 的「變更密碼」頁(``user_change_password``)
      與自訂 admin action 直接呼叫 ``queryset.update()``。
    """

    def save_model(self, request: HttpRequest, obj: Any, form: ModelForm, change: bool) -> None:
        before: dict[str, Any] = {}
        if change and obj.pk is not None:
            current = type(obj)._base_manager.filter(pk=obj.pk).first()
            if current is not None:
                before = {**snapshot(current), **_m2m_snapshot(current)}
        form._audit_before = before  # type: ignore[attr-defined]
        super().save_model(request, obj, form, change)

    def save_related(self, request: HttpRequest, form: ModelForm, formsets: Any, change: bool) -> None:
        super().save_related(request, form, formsets, change)
        obj = form.instance
        before: dict[str, Any] = getattr(form, "_audit_before", {})
        after = {**snapshot(obj), **_m2m_snapshot(obj)}
        action = AuditLog.Action.ADMIN_CHANGE if change else AuditLog.Action.ADMIN_ADD
        entry_before = before if change else {}
        if change and before == after:
            return  # 沒改任何欄位的「儲存」不留紀錄
        record_audit(action, actor=request.user, target=obj, before=entry_before, after=after, label=str(obj)[:200])

    def delete_model(self, request: HttpRequest, obj: Any) -> None:
        self._audit_delete(request, obj)
        super().delete_model(request, obj)

    def delete_queryset(self, request: HttpRequest, queryset: QuerySet) -> None:
        # 批次刪除 action:逐筆留紀錄(預設實作是一次 queryset.delete(),不會呼叫 delete_model)。
        for obj in queryset:
            self._audit_delete(request, obj)
        super().delete_queryset(request, queryset)

    def _audit_delete(self, request: HttpRequest, obj: models.Model) -> None:
        before = {**snapshot(obj), **_m2m_snapshot(obj)}
        record_audit(
            AuditLog.Action.ADMIN_DELETE, actor=request.user, target=obj, before=before, after={}, label=str(obj)[:200]
        )


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("id", "action", "actor_username", "target_type", "target_id", "created_at")
    list_filter = ("action", "target_type", "created_at")
    search_fields = ("actor_username", "target_id")
    # actor shown via actor_username (a plain CharField) — no select_related needed.
    readonly_fields = (
        "actor",
        "actor_username",
        "action",
        "target_type",
        "target_id",
        "changes",
        "metadata",
        "created_at",
    )
    ordering = ("-created_at",)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: AuditLog | None = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: AuditLog | None = None) -> bool:
        return False
