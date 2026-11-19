from typing import Annotated

from ninja import FilterLookup, FilterSchema, Schema
from pydantic import Field, field_validator

from apps.articles.models import Article
from apps.core.schema import TimestampedSchema

# Single source of truth for the status choices: reuse the model's TextChoices
# directly as the field type instead of re-declaring a Literal that would silently
# drift from the DB column. Pydantic validates incoming values against the enum
# (str-based, so "draft"/"published" over the wire still work). We can't use
# ``Literal[*Article.Status.values]`` — mypy rejects Literal built from a runtime
# list. Importing the model here is safe: models.py doesn't import schema.py.
Status = Article.Status


class ArticleCreateRequest(Schema):
    title: str = Field(..., min_length=1, max_length=200, description="Article title.")
    content: str = Field(
        "", max_length=100_000, description="Article body. Plain text/markdown, no HTML sanitization applied."
    )
    status: Status = Field(Status.DRAFT, description="Publication state; creating as published skips a draft step.")


class ArticleUpdateRequest(Schema):
    # ``None`` here means "field omitted" (PATCH semantics via model_dump(exclude_unset=True)
    # in OwnedResourceService.update) — title/content/status are NOT NULL columns, so an
    # explicit ``null`` in the request body must be rejected rather than passed through
    # (it would otherwise reach setattr() and blow up as an uncaught IntegrityError/500).
    title: str | None = Field(None, min_length=1, max_length=200, description="Omit to leave unchanged.")
    content: str | None = Field(None, max_length=100_000, description="Omit to leave unchanged.")
    status: Status | None = Field(
        None, description="Omit to leave unchanged. Setting to published triggers the notify webhook once."
    )

    @field_validator("title", "content", "status", mode="before")
    @classmethod
    def _reject_explicit_null(cls, v: object) -> object:
        if v is None:
            raise ValueError("must not be null")
        return v


class ArticleResponse(TimestampedSchema):
    id: int
    owner_id: int = Field(..., description="ID of the user who owns this article.")
    title: str
    content: str
    status: str


class ArticleFilter(FilterSchema):
    status: Status | None = Field(None, description="Filter by publication state (?status=draft|published).")
    # ?q=foo → WHERE title ILIKE %foo%
    q: Annotated[str | None, FilterLookup(q="title__icontains")] = None
