"""業務稽核:讓 service 層的寫入留下「誰、對哪一筆、改了什麼」。

用法(在業務寫入的同一個 ``transaction.atomic()`` 內呼叫,寫入失敗回滾時稽核也一起回滾,
不會出現「有稽核、沒資料」或反過來)::

    with transaction.atomic():
        before = snapshot(article)
        article.title = "new"
        article.save()
        record_audit(AuditLog.Action.UPDATE, actor=user, target=article, before=before)

- ``before`` / ``after`` 是欄位快照(``snapshot()``);``after`` 省略時從 ``target`` 現值取。
  create 只給 after(before 省略);硬刪除給 before + ``after={}``;軟刪除只給 before(diff 就是 deleted_at)。
- IP 與 request_id 由 ``AuditLog.record`` 從 request context 自動帶入。
- 機密欄位(名稱含 password/secret/token/digest…)只記「有變更」,不記值:稽核表任何
  進得了後台的人都看得到,不能變成第二份密碼/金鑰清單。
"""

from datetime import date, datetime, time
from decimal import Decimal
from typing import Any
from uuid import UUID

from django.contrib.auth.models import AbstractBaseUser, AnonymousUser
from django.db import models

from apps.audit.models import AuditLog

MASK = "******"
# 欄位名稱含這些字(不分大小寫)就遮罩。寧可多遮:漏遮的代價是機密外洩,多遮只是少一點細節。
_SENSITIVE_MARKERS = ("password", "secret", "token", "digest", "api_key", "private_key", "otp", "challenge")
# 每次存檔都會變、不屬於「誰改了什麼」的欄位。
_SKIPPED_FIELDS = frozenset({"created_at", "updated_at"})


def is_sensitive(field_name: str) -> bool:
    name = field_name.lower()
    return any(marker in name for marker in _SENSITIVE_MARKERS)


def _plain(value: Any) -> Any:
    """轉成 JSONField 存得下、且讀得懂的值。"""
    if value is None or isinstance(value, bool | int | float | str):
        return value
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    if isinstance(value, Decimal | UUID):
        return str(value)
    if isinstance(value, bytes | memoryview):
        return MASK  # BinaryField 通常是密文,不記內容
    if isinstance(value, list | tuple | set):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    return str(value)


def snapshot(obj: models.Model, fields: tuple[str, ...] | None = None) -> dict[str, Any]:
    """一筆資料的欄位快照(只含 concrete 欄位;FK 存 id,欄位名用 ``<name>_id``)。"""
    data: dict[str, Any] = {}
    for field in obj._meta.concrete_fields:
        if field.primary_key or field.name in _SKIPPED_FIELDS:
            continue
        if fields is not None and field.name not in fields and field.attname not in fields:
            continue
        data[field.attname] = _plain(getattr(obj, field.attname))
    return data


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, list[Any]]:
    """``{"field": [old, new]}``,只列有變的欄位;機密欄位的值換成遮罩。"""
    changes: dict[str, list[Any]] = {}
    for field in sorted({*before, *after}):
        old, new = before.get(field), after.get(field)
        if old == new:
            continue
        if is_sensitive(field):
            changes[field] = [None if old is None else MASK, None if new is None else MASK]
        else:
            changes[field] = [old, new]
    return changes


def target_label(model: type[models.Model] | models.Model) -> str:
    return f"{model._meta.app_label}.{model._meta.model_name}"


def record_audit(
    action: str,
    *,
    actor: AbstractBaseUser | AnonymousUser | None,
    target: models.Model | type[models.Model] | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    **metadata: object,
) -> AuditLog:
    """寫一筆業務稽核。必須在業務寫入的同一個交易內呼叫(見模組說明)。

    ``target`` 傳 model instance(單筆)或 model class(批次操作,如匯出,沒有單一 pk)。
    ``before``/``after`` 都沒給時不算 diff(例如 export)。
    """
    target_type = target_id = ""
    if target is not None:
        target_type = target_label(target)
        if isinstance(target, models.Model):
            target_id = str(target.pk) if target.pk is not None else ""

    changes: dict[str, list[Any]] | None = None
    if before is not None or after is not None:
        if after is None and isinstance(target, models.Model):
            after = snapshot(target)
        changes = diff(before or {}, after or {})

    user = actor if isinstance(actor, AbstractBaseUser) else None
    return AuditLog.record(action, user=user, target_type=target_type, target_id=target_id, changes=changes, **metadata)
