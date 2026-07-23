import os

from celery import Celery
from celery.signals import setup_logging

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")

app = Celery("django-ninja-project-tree")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# 匯入即註冊 task_failure / task_retry signal handler。必須在這裡做 ——
# worker 與 beat 都會載入本模組,而 config.alerting 沒有其他匯入點,
# 少了這行 signal 就永遠不會被接上(而且不會有任何報錯提示)。
import config.alerting  # noqa: E402,F401


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
