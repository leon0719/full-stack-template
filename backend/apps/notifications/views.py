from ninja import Query, Router

from apps.accounts.authentication import require_role
from apps.accounts.roles import Role
from apps.core.pagination import StandardPagination
from apps.core.schema import BaseResponse, Page
from apps.notifications.schema import NotificationResponse
from apps.notifications.services import LineWebhookService, NotificationService

# No router-level auth: the LINE webhook authenticates by signature, the rest set auth per operation.
notifications_router = Router(tags=["notifications"])


@notifications_router.post("/line/webhook", response=BaseResponse[None], auth=None)
def line_webhook(request):
    """LINE Messaging API webhook. Authenticated by ``X-Line-Signature`` (HMAC-SHA256 of the raw body
    with LINE_MESSAGING_CHANNEL_SECRET), not by a bearer token. Set the LINE console webhook URL to
    ``https://<domain>/notifications/line/webhook``."""
    LineWebhookService.handle(request.body, request.headers.get("X-Line-Signature", ""))
    return BaseResponse()


@notifications_router.get("/failed", response=BaseResponse[Page[NotificationResponse]], auth=require_role(Role.ADMIN))
def list_failed_notifications(request, page: StandardPagination.Input = Query(...)):
    """Admin only: notifications not delivered yet (retrying or abandoned), newest first."""
    qs = NotificationService.failed_qs()
    return BaseResponse(data=StandardPagination().paginate_queryset(qs, page, request))
