import os

from celery import Celery
from celery.signals import setup_logging

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")

app = Celery("django-ninja-project-tree")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@setup_logging.connect
def _setup_logging(**_kwargs: object) -> None:
    """Route worker/beat logs through Django's LOGGING (→ loguru, JSON in prod).

    Connecting this signal makes Celery skip its own logging configuration
    entirely — without it, worker-internal logs (task received/succeeded/…)
    would bypass loguru and come out as plaintext next to the JSON stream.
    """
    import logging.config

    from django.conf import settings

    logging.config.dictConfig(settings.LOGGING)
