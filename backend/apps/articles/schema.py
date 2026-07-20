from typing import Annotated

from ninja import FilterLookup, FilterSchema, Schema
from pydantic import Field

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
    title: str = Field(..., min_length=1, max_length=200)
    content: str = ""
    status: Status = Status.DRAFT


class ArticleUpdateRequest(Schema):
    title: str | None = Field(None, min_length=1, max_length=200)
    content: str | None = None
    status: Status | None = None


class ArticleResponse(TimestampedSchema):
    id: int
    owner_id: int
    title: str
    content: str
    status: str


class ArticleFilter(FilterSchema):
    status: Status | None = None
    # ?q=foo → WHERE title ILIKE %foo%
    q: Annotated[str | None, FilterLookup(q="title__icontains")] = None
