"""Third-party HTTP calls for the articles app.

Per project convention this module is the ONLY place ``httpx`` may appear, and
every outbound call is wrapped with ``@handle_api_call_graceful`` from
``config/external_api_handler`` so retries, logging and degradation stay
consistent: failure is retried, then logged and swallowed.

The publish webhook below is best-effort — a broken third-party endpoint must
never fail (and endlessly re-queue) the Celery task that publishes an article.
"""

import httpx
from django.conf import settings
from loguru import logger

from config.external_api_handler import handle_api_call_graceful

_WEBHOOK_TIMEOUT_SECONDS = 5.0


@handle_api_call_graceful("article-published-webhook")
def notify_article_published_webhook(article_id: int, title: str, *, event_id: str | None = None) -> None:
    """POST a best-effort notification to ``ARTICLE_PUBLISHED_WEBHOOK_URL``.

    No-op when the URL is unset (empty string = integration disabled). Transient
    errors are retried with backoff; persistent failure is logged and swallowed
    by ``handle_api_call_graceful`` — publishing must not depend on the webhook.
    Delivery is best-effort (dropped on broker outage, after transient retries or
    on an HTTP error) and may still be duplicated on redelivery: ``event_id`` is
    the dedup key consumers should treat as "already processed" on repeats.
    """
    url = settings.ARTICLE_PUBLISHED_WEBHOOK_URL
    if not url:
        logger.debug("[External] article-published webhook disabled - no URL configured")
        return
    response = httpx.post(
        url,
        json={"event": "article.published", "event_id": event_id, "article_id": article_id, "title": title},
        timeout=_WEBHOOK_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    logger.info("[External] article-published webhook delivered - article_id: {id}", id=article_id)
