from celery import shared_task
from django.utils import timezone
from loguru import logger

from apps.accounts.models import AuthToken


@shared_task(name="accounts.purge_expired_tokens")
def purge_expired_tokens() -> int:
    """Delete auth tokens past their expiry.

    Idempotent and safe to run on a schedule (see CELERY_BEAT_SCHEDULE in
    config/settings/base.py). Complements the lazy per-request deletion in
    BearerAuth so stale rows don't accumulate for tokens that are never
    presented again.
    """
    deleted, _ = AuthToken.objects.filter(expiry__lt=timezone.now()).delete()
    logger.info("[Task] purged {n} expired auth tokens", n=deleted)
    return deleted
