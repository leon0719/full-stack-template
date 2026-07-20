from django.contrib import admin

from apps.articles.models import Article


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "owner", "status", "created_at")
    list_filter = ("status", "created_at")
    search_fields = ("title", "content", "owner__username")
    # FK shown in list_display → select_related to avoid an N+1 on the changelist.
    list_select_related = ("owner",)
    autocomplete_fields = ("owner",)
    # Mixin-managed timestamps are display-only.
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-created_at",)
