from django.conf import settings
from django.db import models

from apps.core.models import TimestampedModel


class Article(TimestampedModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="articles",
    )
    title = models.CharField(max_length=200)
    content = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            # Serves "list my articles, newest first" — the default query path.
            models.Index(fields=["owner", "-created_at"]),
            # Serves ?status= filtering, which is always owner-scoped. A bare
            # status index would be too low-selectivity to ever be chosen.
            models.Index(fields=["owner", "status"]),
        ]

    def __str__(self) -> str:
        return self.title
