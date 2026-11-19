"""Business logic for articles. Views delegate here; this layer never touches HTTP.

Every write records a business audit entry (``record_audit``) inside the same
``transaction.atomic()`` as the write itself — the reference for other apps.
"""

from dataclasses import dataclass
from typing import Literal

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser
from django.db import transaction
from django.db.models import QuerySet
from loguru import logger
from ninja import Schema

from apps.articles.models import Article
from apps.articles.schema import ArticleFilter, ArticleUpdateRequest
from apps.audit.models import AuditLog
from apps.audit.services import record_audit, snapshot
from apps.core.exports import (
    PDF_CONTENT_TYPE,
    XLSX_CONTENT_TYPE,
    ZIP_CONTENT_TYPE,
    build_pdf_table,
    build_xlsx,
    build_zip,
    export_filename,
)
from apps.core.services import OwnedResourceService
from config.errors import AppError, ErrorCode

ExportFormat = Literal["xlsx", "pdf", "zip"]

_EXPORT_HEADERS = ("ID", "標題", "狀態", "內容摘要", "建立時間", "更新時間")
_EXPORT_PDF_WIDTHS_MM = (15, 60, 22, 110, 33, 33)
_SUMMARY_CHARS = 100


@dataclass(frozen=True)
class ExportFile:
    content: bytes
    filename: str
    content_type: str


class ArticleService(OwnedResourceService[Article]):
    # No select_related("owner"): responses expose only owner_id, which lives
    # on the articles row itself — a users JOIN would be pure overhead.
    model = Article

    @classmethod
    def list_for_user(cls, user: AbstractBaseUser, filters: ArticleFilter) -> QuerySet[Article]:
        return filters.filter(cls.owned_qs(user))

    @classmethod
    def create(cls, user: AbstractBaseUser, payload: Schema) -> Article:
        with transaction.atomic():
            article = super().create(user, payload)
            record_audit(AuditLog.Action.CREATE, actor=user, target=article, after=snapshot(article))
        return article

    @classmethod
    def delete_owned(cls, user: AbstractBaseUser, article_id: int) -> None:
        with transaction.atomic():
            article = cls.get_owned_or_404(user, article_id)
            before = snapshot(article)
            cls.delete(article)
            record_audit(AuditLog.Action.DELETE, actor=user, target=article, before=before)

    @classmethod
    def restore_owned(cls, user: AbstractBaseUser, pk: int) -> Article:
        with transaction.atomic():
            article = super().restore_owned(user, pk)
            record_audit(AuditLog.Action.RESTORE, actor=user, target=article)
        return article

    @classmethod
    def export(cls, user: AbstractBaseUser, filters: ArticleFilter, file_format: ExportFormat) -> ExportFile:
        """Export the caller's articles (same filters as the list endpoint) as xlsx / pdf / zip(both)."""
        qs = cls.list_for_user(user, filters)
        count = qs.count()
        if count > settings.EXPORT_MAX_ROWS:
            logger.warning("[Service] export rejected - rows: {n}, max: {m}", n=count, m=settings.EXPORT_MAX_ROWS)
            raise AppError(
                422,
                ErrorCode.EXPORT_TOO_LARGE,
                f"Too many rows to export ({count} > {settings.EXPORT_MAX_ROWS}); narrow the filters.",
            )
        rows = [
            (a.id, a.title, a.get_status_display(), a.content[:_SUMMARY_CHARS], a.created_at, a.updated_at)
            for a in qs.only("id", "title", "status", "content", "created_at", "updated_at")
        ]

        def xlsx() -> bytes:
            return build_xlsx(_EXPORT_HEADERS, rows, sheet_title="文章")

        def pdf() -> bytes:
            return build_pdf_table("文章清單", _EXPORT_HEADERS, rows, col_widths_mm=_EXPORT_PDF_WIDTHS_MM)

        if file_format == "xlsx":
            result = ExportFile(xlsx(), export_filename("文章", "xlsx"), XLSX_CONTENT_TYPE)
        elif file_format == "pdf":
            result = ExportFile(pdf(), export_filename("文章", "pdf"), PDF_CONTENT_TYPE)
        else:
            content = build_zip({"文章.xlsx": xlsx(), "文章.pdf": pdf()})
            result = ExportFile(content, export_filename("文章", "zip"), ZIP_CONTENT_TYPE)
        # 匯出是「誰把哪些資料帶走了」:沒有單一對象(target 傳 model class),記筆數與格式。
        record_audit(AuditLog.Action.EXPORT, actor=user, target=Article, format=file_format, rows=count)
        logger.info(
            "[Service] articles exported - user_id: {uid}, rows: {n}, format: {f}", uid=user.pk, n=count, f=file_format
        )
        return result

    @classmethod
    def update_owned(
        cls, user: AbstractBaseUser, article_id: int, payload: ArticleUpdateRequest
    ) -> tuple[Article, bool]:
        """Update an owned article; the second element is True only for the one
        request that performed the draft→published transition.

        The transition is *claimed* with an atomic rows-affected UPDATE
        (``WHERE status != published``) so two concurrent PATCHes can never
        both observe "was draft" and double-fire the publish side effect.
        """
        with transaction.atomic():
            article = cls.get_owned_or_404(user, article_id)
            before = snapshot(article)
            just_published = False
            if "status" in payload.model_fields_set and payload.status == Article.Status.PUBLISHED:
                claimed = (
                    cls.owned_qs(user)
                    .filter(pk=article.pk)
                    .exclude(status=Article.Status.PUBLISHED)
                    .update(status=Article.Status.PUBLISHED)
                )
                just_published = claimed == 1
            updated = cls.update(article, payload)
            record_audit(AuditLog.Action.UPDATE, actor=user, target=updated, before=before)
        return updated, just_published
