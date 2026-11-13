from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone
from loguru import logger

from apps.audit.models import AuditLog


@shared_task(name="audit.purge_old_audit_logs")
def purge_old_audit_logs() -> int:
    """Delete audit rows older than AUDIT_LOG_RETENTION_DAYS (0 disables the purge).

    Idempotent and safe to run on a schedule (see CELERY_BEAT_SCHEDULE in
    config/settings/base.py).
    """
    retention_days = settings.AUDIT_LOG_RETENTION_DAYS
    if retention_days == 0:
        logger.info("[Task] audit log purge disabled (AUDIT_LOG_RETENTION_DAYS=0)")
        return 0
    cutoff = timezone.now() - timedelta(days=retention_days)
    deleted, _ = AuditLog.objects.filter(created_at__lt=cutoff).delete()
    logger.info("[Task] purged {n} audit log rows older than {d} days", n=deleted, d=retention_days)
    return deleted
