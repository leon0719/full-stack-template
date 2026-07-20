from celery import shared_task
from django.db import OperationalError
from loguru import logger

from apps.articles.external_services import notify_article_published_webhook
from apps.articles.models import Article


@shared_task(
    name="articles.notify_article_published",
    bind=True,
    # Reliability template — pairs with the global CELERY_TASK_ACKS_LATE:
    #   acks_late     → re-runs if the WORKER dies mid-task (needs idempotency)
    #   autoretry_for → re-runs on an exception raised INSIDE the task
    # Retry ONLY transient DB errors (e.g. a dropped/recycled connection). The
    # webhook is fire-and-forget via @handle_api_call_graceful, which swallows
    # its own errors, so a task-level exception here means the DB read failed —
    # retrying that is worth it, retrying a genuine bug (KeyError, TypeError…)
    # is not. Bare Exception would retry real bugs 3x and delay the alert.
    # NOTE: don't autoretry on top of the strict @handle_api_call wrapper (its
    # own tenacity retry) — the retry counts would multiply.
    autoretry_for=(OperationalError,),
    retry_backoff=True,
    retry_backoff_max=60,
    retry_jitter=True,
    max_retries=3,
)
def notify_article_published(self, article_id: int) -> str:
    """Fire-and-forget side effect for a published article (webhook notification).

    Tasks take primitive args (an id, not a model) and must be idempotent, because
    acks_late (config/settings/base.py) and autoretry can each run the body more
    than once. DB work here is naturally idempotent; the webhook is at-least-once,
    so the payload carries an event id (the task id — stable across retries and
    broker re-deliveries) for the consumer to deduplicate on.
    """
    article = Article.objects.filter(pk=article_id).only("id", "title").first()
    if article is None:
        # Deleted between publish and task execution — nothing to notify.
        logger.warning("[Task] published article no longer exists - id: {id}", id=article_id)
        return "skipped"
    # Graceful external call: webhook failure is logged, never raised — so the
    # task does not retry (and re-notify) over a broken third-party endpoint.
    notify_article_published_webhook(article.pk, article.title, event_id=self.request.id)
    logger.info("[Task] notify published article - id: {id}", id=article_id)
    return "ok"
