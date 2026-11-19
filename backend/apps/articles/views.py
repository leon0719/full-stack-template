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
from apps.articles.services import ArticleService, ExportFormat
from apps.articles.tasks import notify_article_published
from apps.core.exports import attachment_response
from apps.core.pagination import StandardPagination
from apps.core.schema import BaseResponse, Page
from apps.core.throttling import ExportThrottle, WriteRateThrottle

# Router-level auth: every endpoint below requires a valid bearer token.
articles_router = Router(tags=["articles"], auth=BearerAuth())


@articles_router.get("", response=BaseResponse[Page[ArticleResponse]])
def list_articles(request, filters: ArticleFilter = Query(...), page: StandardPagination.Input = Query(...)):
    """List the caller's own articles (paginated: ?page=&page_size=)."""
    qs = ArticleService.list_for_user(request.auth, filters)
    return BaseResponse(data=StandardPagination().paginate_queryset(qs, page, request))


# File download, so no BaseResponse envelope on success (errors still use it — e.g. 422 export_too_large).
@articles_router.get(
    "/export",
    throttle=[ExportThrottle()],
    openapi_extra={
        "responses": {
            200: {
                "description": "xlsx / pdf / zip file (Content-Disposition carries the UTF-8 filename).",
                "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}},
            }
        }
    },
)
def export_articles(
    request,
    filters: ArticleFilter = Query(...),
    file_format: ExportFormat = Query("xlsx", alias="format"),
):
    """Download the caller's articles (same ?status= / ?q= as the list) as
    ?format=xlsx | pdf | zip (zip = both). Capped at EXPORT_MAX_ROWS rows."""
    export = ArticleService.export(request.auth, filters, file_format)
    return attachment_response(export.content, export.filename, export.content_type)


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
        # committed (under autocommit it runs immediately; it defers only if
        # ATOMIC_REQUESTS is on or the service is wrapped in transaction.atomic).
        # robust=True: the publish is already committed, so an unreachable broker
        # drops the notification with an error log (best-effort webhook) instead
        # of 500ing a PATCH whose retry could never re-claim the transition.
        transaction.on_commit(lambda: notify_article_published.delay(updated.id), robust=True)
    return BaseResponse(data=updated)


# Team contract: delete answers 200 + empty envelope, not 204 (clients always parse a body).
@articles_router.delete("/{int:article_id}", response=BaseResponse[None], throttle=[WriteRateThrottle()])
def delete_article(request, article_id: int):
    ArticleService.delete_owned(request.auth, article_id)
    return BaseResponse()


@articles_router.post(
    "/{int:article_id}/restore", response=BaseResponse[ArticleResponse], throttle=[WriteRateThrottle()]
)
def restore_article(request, article_id: int):
    return BaseResponse(data=ArticleService.restore_owned(request.auth, article_id))
