"""Shared abstract models / mixins reused across apps."""

from django.db import models
from django.utils import timezone


class TimestampedModel(models.Model):
    """Adds self-managing ``created_at`` / ``updated_at`` columns.

    Abstract — produces no table of its own; concrete models inherit the fields.
    """

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class SoftDeleteManager(models.Manager):
    """Default manager: excludes soft-deleted rows from every ordinary query."""

    def get_queryset(self) -> models.QuerySet:
        return super().get_queryset().filter(deleted_at__isnull=True)


class SoftDeleteModel(models.Model):
    """Adds a ``deleted_at`` column and swaps the default manager to hide
    soft-deleted rows.

    ``objects`` (the default manager) filters out deleted rows so existing
    owner-scoped queries need no changes. ``all_objects`` is unfiltered — use
    it for admin and restore lookups that must still find deleted rows.
    """

    deleted_at = models.DateTimeField(null=True, blank=True, default=None)

    # objects must stay declared first — Django uses the first manager attribute
    # as the default manager. ruff's DJ012 misreads the second manager here as
    # a misplaced field; noqa is the documented escape for that false positive.
    objects = SoftDeleteManager()
    all_objects = models.Manager()  # noqa: DJ012

    class Meta:
        abstract = True
        # The deletion collector (cascades, post_delete signals) uses the base
        # manager, not the default one. Without this, deleting a related row
        # (e.g. a User) would miss already-soft-deleted children, since the
        # default manager filters them out of the collector's own query.
        # Subclasses with their own Meta must subclass this one to keep it:
        # class Meta(SoftDeleteModel.Meta): ...
        base_manager_name = "all_objects"

    def soft_delete(self) -> None:
        self.deleted_at = timezone.now()
        self.save(update_fields=["deleted_at"])

    def restore(self) -> None:
        self.deleted_at = None
        self.save(update_fields=["deleted_at"])
