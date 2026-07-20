from config.logging import setup_loguru
from config.settings.base import *  # noqa: F403
from config.settings.base import ENV

# Fail-fast footgun guard: DJANGO_SETTINGS_MODULE defaults to this module
# (see config/asgi.py, config/celery.py, manage.py). If a prod deploy forgets
# to set it, we would silently boot with DEBUG=True + LocMemCache and bypass
# base.py's _validate_prod hardening (which keys off ENV, not the settings
# module). Refuse to load the local settings when ENV says prod.
if ENV == "prod":
    raise RuntimeError(
        "config.settings.local loaded while ENV=prod. Set DJANGO_SETTINGS_MODULE=config.settings.prod for production."
    )

DEBUG = True
setup_loguru(debug=DEBUG, json_logs=False)

LOGGING["root"]["level"] = "DEBUG"  # type: ignore[index]  # noqa: F405
# ALLOWED_HOSTS / CORS_ALLOWED_ORIGINS come from base.py: .env.local wins,
# otherwise the pydantic dev-friendly defaults apply (Docker host + common
# frontend dev ports) — no hardcoded override here so env config stays effective.
CORS_ALLOW_ALL_ORIGINS = False
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
