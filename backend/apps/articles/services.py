"""Business logic for articles. Views delegate here; this layer never touches HTTP."""

from django.contrib.auth.models import AbstractBaseUser
from django.db.models import QuerySet

from apps.articles.models import Article
from apps.articles.schema import ArticleFilter, ArticleUpdateRequest
from apps.core.services import OwnedResourceService


class ArticleService(OwnedResourceService[Article]):
    # No select_related("owner"): responses expose only owner_id, which lives
    # on the articles row itself — a users JOIN would be pure overhead.
    model = Article

    @classmethod
    def list_for_user(cls, user: AbstractBaseUser, filters: ArticleFilter) -> QuerySet[Article]:
        return filters.filter(cls.owned_qs(user))

    @classmethod
    def update_owned(
        cls, user: AbstractBaseUser, article_id: int, payload: ArticleUpdateRequest
    ) -> tuple[Article, bool]:
        """Update an owned article; the second element is True only for the one
        request that performed the draft→published transition.

        The transition is *claimed* with an atomic rows-affected UPDATE
        (``WHERE status != published``) so two concurrent PATCHes can never
        both observe "was draft" and double-fire the publish side effect.
        """
        article = cls.get_owned_or_404(user, article_id)
        just_published = False
        if "status" in payload.model_fields_set and payload.status == Article.Status.PUBLISHED:
            claimed = (
                cls.owned_qs(user)
                .filter(pk=article.pk)
                .exclude(status=Article.Status.PUBLISHED)
                .update(status=Article.Status.PUBLISHED)
            )
            just_published = claimed == 1
        return cls.update(article, payload), just_published
