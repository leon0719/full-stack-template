from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from ninja import NinjaAPI

from apps.accounts.views import auth_router
from apps.articles.views import articles_router
from apps.health.views import health_router
from config.exceptions import register_exception_handlers
from config.ninja_config import ORJSONParser, ORJSONRenderer

api = NinjaAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    parser=ORJSONParser(),
    renderer=ORJSONRenderer(),
    # Expose interactive docs only outside production to avoid leaking the full
    # API schema publicly. Set DEBUG=True (local) to browse /api/docs.
    docs_url="/api/docs" if settings.DEBUG else None,
)
register_exception_handlers(api)
api.add_router("", health_router, tags=["health"])
api.add_router("/auth", auth_router)
api.add_router("/articles", articles_router)


# Static files (admin CSS/JS) are served by whitenoise middleware in every env.
urlpatterns = [
    path("admin/", admin.site.urls),
    path("accounts/", include("allauth.urls")),
    path("", api.urls),
]
