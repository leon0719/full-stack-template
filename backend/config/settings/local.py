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
# Django 6.1+: MAILERS replaces the deprecated EMAIL_BACKEND/EMAIL_* settings.
MAILERS = {"default": {"BACKEND": "django.core.mail.backends.console.EmailBackend"}}

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# LINE Login local testing (cloudflared quick tunnel — see docs/development.md's
# "LINE 登入本地測試" section) proxies HTTPS to the container over plain HTTP.
# allauth builds its OAuth redirect_uri from request.build_absolute_uri(), which
# follows request.scheme; without this, request.scheme stays "http" even though
# the browser is on "https", so redirect_uri mismatches the https:// callback URL
# registered in the LINE Developers Console and LINE rejects the request.
#
# uvicorn's own FORWARDED_ALLOW_IPS trust (uvicorn_run.py) only rewrites the ASGI
# scope for requests from a trusted peer IP — cloudflared runs on the host, so the
# container sees the docker bridge gateway as the peer, not 127.0.0.1. Rather than
# widening FORWARDED_ALLOW_IPS (which also affects the trusted client IP used by
# throttling), tell Django directly to trust X-Forwarded-Proto — the same setting
# prod.py uses, but there the reverse proxy is the only way to reach the app at
# all, whereas here nothing but the developer's own tunnel sits in front. Safe
# because local dev is never exposed to the internet except through that tunnel.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
