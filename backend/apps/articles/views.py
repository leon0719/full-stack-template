from django.db import transaction
from ninja import Query, Router
from ninja.responses import Status

from apps.accounts.authentication import BearerAuth
from apps.articles.schema import (
    ArticleCreateRequest,
    ArticleFilter,
    ArticleResponse,
    ArticleUpdateRequest,
)
from apps.articles.services import ArticleService
from apps.articles.tasks import notify_article_published
from apps.core.pagination import StandardPagination
from apps.core.schema import BaseResponse, Page
from apps.core.throttling import WriteRateThrottle

# Router-level auth: every endpoint below requires a valid bearer token.
articles_router = Router(tags=["articles"], auth=BearerAuth())


@articles_router.get("", response=BaseResponse[Page[ArticleResponse]])
def list_articles(request, filters: ArticleFilter = Query(...), page: StandardPagination.Input = Query(...)):
    """List the caller's own articles (paginated: ?page=&page_size=)."""
    qs = ArticleService.list_for_user(request.auth, filters)
    return BaseResponse(data=StandardPagination().paginate_queryset(qs, page, request))


@articles_router.post("", response={201: BaseResponse[ArticleResponse]}, throttle=[WriteRateThrottle()])
def create_article(request, payload: ArticleCreateRequest):
    return Status(201, BaseResponse(data=ArticleService.create(request.auth, payload)))


@articles_router.get("/{int:article_id}", response=BaseResponse[ArticleResponse])
def get_article(request, article_id: int):
    return BaseResponse(data=ArticleService.get_owned_or_404(request.auth, article_id))


@articles_router.patch("/{int:article_id}", response=BaseResponse[ArticleResponse], throttle=[WriteRateThrottle()])
def update_article(request, article_id: int, payload: ArticleUpdateRequest):
    # The service claims the draft→published transition atomically, so the
    # side-effect fires exactly once even under concurrent PATCHes.
    updated, just_published = ArticleService.update_owned(request.auth, article_id, payload)
    if just_published:
        # on_commit so the worker can't pick the task up before the row is
        # committed (a no-op under autocommit, load-bearing if anyone enables
        # ATOMIC_REQUESTS or wraps the service in transaction.atomic).
        transaction.on_commit(lambda: notify_article_published.delay(updated.id))
    return BaseResponse(data=updated)


# Team contract: delete answers 200 + empty envelope, not 204 (clients always parse a body).
@articles_router.delete("/{int:article_id}", response=BaseResponse[None], throttle=[WriteRateThrottle()])
def delete_article(request, article_id: int):
    article = ArticleService.get_owned_or_404(request.auth, article_id)
    ArticleService.delete(article)
    return BaseResponse()
