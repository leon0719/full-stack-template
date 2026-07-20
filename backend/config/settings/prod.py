from django.utils.csp import CSP

from config.logging import setup_loguru
from config.settings.base import *  # noqa: F403
from config.settings.base import MIDDLEWARE, settings

DEBUG = False
setup_loguru(debug=DEBUG, json_logs=True)

# Public hostnames + loopback so the in-container HEALTHCHECK (curl on
# localhost) is not rejected with DisallowedHost.
ALLOWED_HOSTS = [*settings.get_allowed_hosts(), "localhost", "127.0.0.1"]

# TLS terminates at the reverse proxy / load balancer; trust its
# X-Forwarded-Proto so SECURE_SSL_REDIRECT doesn't loop, and exempt health
# probes (they hit the container directly over plain HTTP).
SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_REDIRECT_EXEMPT = [r"^health/"]

# django-ninja throttling: how many trusted reverse proxies sit in front of the
# app. Without this, ninja keys per-IP throttles on the RAW X-Forwarded-For
# string — which the CLIENT controls — so login/register rate limits could be
# bypassed by sending a different XFF value on every request. With N proxies,
# ninja keys on the Nth-from-last XFF entry (the one appended by a trusted
# proxy). Note: uvicorn's FORWARDED_ALLOW_IPS does NOT sanitise this header for
# Django; it only rewrites REMOTE_ADDR/scheme. Configure via NINJA_NUM_PROXIES
# (default 1) and keep it in sync with your proxy hop count.
NINJA_NUM_PROXIES = settings.NINJA_NUM_PROXIES

SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_SECURE = True

# Content Security Policy (Django 6.0 built-in). This is an API-only service
# and /api/docs is disabled in prod (config/urls.py gates it on DEBUG), so the
# only HTML surface is /admin/ — the policy below is scoped to it. If you ever
# enable the docs page in prod, its CDN template additionally needs
# cdn.jsdelivr.net in script-src/style-src, 'unsafe-inline' in script-src (the
# bootstrap <script> embeds the CSRF token, so it can't be hash-allowed) and
# https://django-ninja.dev in img-src (favicon).
MIDDLEWARE = [*MIDDLEWARE, "django.middleware.csp.ContentSecurityPolicyMiddleware"]
SECURE_CSP = {
    "default-src": [CSP.NONE],
    "script-src": [CSP.SELF],
    # 'unsafe-inline' kept for style: the admin still uses inline style
    # attributes in places; scripts are fully external so script-src stays strict.
    "style-src": [CSP.SELF, CSP.UNSAFE_INLINE],
    "img-src": [CSP.SELF, "data:"],
    "font-src": [CSP.SELF],
    "connect-src": [CSP.SELF],
    "frame-ancestors": [CSP.NONE],
    "base-uri": [CSP.SELF],
    "form-action": [CSP.SELF],
}

# The API's own https origin(s) — used by the Django admin's CSRF check.
# Distinct from CORS_ALLOWED_ORIGINS (which lists frontend origins).
CSRF_TRUSTED_ORIGINS = settings.get_csrf_trusted_origins()

# Hashed + gzip'd static files (immutable cache headers via whitenoise).
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
