from django.contrib import admin

from apps.articles.models import Article
from apps.audit.admin import AuditedAdminMixin


@admin.register(Article)
class ArticleAdmin(AuditedAdminMixin, admin.ModelAdmin):
    list_display = ("id", "title", "owner", "status", "deleted_at", "created_at")
    list_filter = ("status", "deleted_at", "created_at")
    search_fields = ("title", "content", "owner__username")
    # FK shown in list_display → select_related to avoid an N+1 on the changelist.
    list_select_related = ("owner",)
    autocomplete_fields = ("owner",)
    # Mixin-managed timestamps are display-only.
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-created_at",)

    def get_queryset(self, request):
        # all_objects (unfiltered): admins must still see/restore soft-deleted rows.
        qs = Article.all_objects.get_queryset()
        if self.list_select_related:
            qs = qs.select_related(*self.list_select_related)
        return qs
