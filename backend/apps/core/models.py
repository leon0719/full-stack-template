"""Shared abstract models / mixins reused across apps."""

from django.db import models


class TimestampedModel(models.Model):
    """Adds self-managing ``created_at`` / ``updated_at`` columns.

    Abstract — produces no table of its own; concrete models inherit the fields.
    """

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
