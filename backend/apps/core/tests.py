"""Tests for apps.core shared primitives."""

import pytest

from apps.core.security import generate_token, hash_token


@pytest.mark.unit
def test_generate_token_digest_matches_hash():
    raw, digest = generate_token()
    assert digest == hash_token(raw)


@pytest.mark.unit
def test_generate_token_returns_distinct_values():
    raw1, _ = generate_token()
    raw2, _ = generate_token()
    assert raw1 != raw2


@pytest.mark.integration
def test_owned_resource_service_owner_isolation(user, other_user):
    from django.http import Http404

    from apps.articles.models import Article
    from apps.core.services import OwnedResourceService

    class _ArticleSvc(OwnedResourceService[Article]):
        model = Article
        select_related = ("owner",)

    mine = Article.objects.create(owner=user, title="mine")
    Article.objects.create(owner=other_user, title="theirs")

    assert _ArticleSvc.get_owned_or_404(user, mine.pk).pk == mine.pk
    assert list(_ArticleSvc.owned_qs(user)) == [mine]
    with pytest.raises(Http404):
        _ArticleSvc.get_owned_or_404(user, mine.pk + 999)
    # Cross-owner fetch is the primary IDOR path: a non-owner must get 404, not the row.
    with pytest.raises(Http404):
        _ArticleSvc.get_owned_or_404(other_user, mine.pk)
