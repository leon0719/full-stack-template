"""Structured, queryable audit trail: account security events + business writes.

Complements (doesn't replace) the loguru text logs already emitted alongside
each event in apps/accounts/adapters.py and apps/accounts/services.py —
those are for operational log search; this is for "who did what, when",
queried through Django admin.

- 帳號安全事件:``AuditLog.record(action, user=...)``(沒有 target/diff)。
- 業務寫入:``apps.audit.services.record_audit()``(target + 欄位 diff,機密欄位遮罩)。
- Django admin 的新增/修改/刪除:``apps.audit.admin.AuditedAdminMixin``。
"""

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser
from django.db import models

from config.middleware import get_request_context


class AuditLog(models.Model):
    class Action(models.TextChoices):
        # LINE Login(apps/accounts/adapters.py):成功 = allauth 完成登入、發出 exchange code;
        # 失敗 = LINE 回傳錯誤或使用者在同意畫面按取消(沒有 actor)。
        LINE_LOGIN_SUCCESS = "line_login_success", "LINE login succeeded"
        LINE_LOGIN_FAILED = "line_login_failed", "LINE login failed"
        LOGOUT = "logout", "Logout"
        # Django admin 的帳密登入(createsuperuser 建的管理員;apps/accounts/signals.py)。
        ADMIN_LOGIN_SUCCESS = "admin_login_success", "Admin login succeeded"
        ADMIN_LOGIN_FAILED = "admin_login_failed", "Admin login failed"
        # 業務寫入(record_audit)。新動詞加在這裡(只改 choices 的 migration,不動資料)。
        CREATE = "create", "Created"
        UPDATE = "update", "Updated"
        DELETE = "delete", "Deleted"
        RESTORE = "restore", "Restored"
        EXPORT = "export", "Exported"
        # Django admin 的異動(AuditedAdminMixin)。跟 API 的 create/update/delete 分開,
        # 查「誰繞過 API 直接在後台改資料」時一個 filter 就看得到。
        ADMIN_ADD = "admin_add", "Admin added"
        ADMIN_CHANGE = "admin_change", "Admin changed"
        ADMIN_DELETE = "admin_delete", "Admin deleted"

    # SET_NULL (not CASCADE, unlike most FKs in this project): an audit trail
    # must survive the actor being deleted later. actor_username snapshots the
    # name at write time so the record stays meaningful once actor goes NULL.
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    actor_username = models.CharField(max_length=150, blank=True)
    action = models.CharField(max_length=40, choices=Action.choices)
    # 被操作的對象("<app_label>.<model>" + pk 字串)。帳號安全事件留空。
    # db_default(不只是 default):migrate 會在舊版程式還在服務時先跑,舊程式 INSERT
    # 不帶這些欄位也不能違反 NOT NULL(expand/contract,見 docs/backend-standards.md)。
    target_type = models.CharField(max_length=100, blank=True, db_default="")
    target_id = models.CharField(max_length=64, blank=True, db_default="")
    # 欄位 diff:{"field": [old, new], ...};機密欄位的值會被遮罩。沒有 diff 的事件為 NULL。
    changes = models.JSONField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["actor", "-created_at"]),
            models.Index(fields=["action", "-created_at"]),
            # 「這一筆資料被誰改過」——admin 與 API 查單一對象歷程的路徑。
            models.Index(fields=["target_type", "target_id", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.action} - {self.actor_username or 'unknown'}"

    @classmethod
    def record(
        cls,
        action: str,
        user: AbstractBaseUser | None = None,
        *,
        target_type: str = "",
        target_id: str = "",
        changes: dict[str, list[object]] | None = None,
        **metadata: object,
    ) -> AuditLog:
        # request_id / ip 來自 config.middleware(API 與 admin 請求都會經過);
        # Celery task / management command 內呼叫時沒有 request,兩者就不會出現。
        for key, value in get_request_context().items():
            if value:
                metadata.setdefault(key, value)
        return cls.objects.create(
            actor=user,
            actor_username=getattr(user, "username", ""),
            action=action,
            target_type=target_type,
            target_id=target_id,
            changes=changes,
            metadata=metadata,
        )
