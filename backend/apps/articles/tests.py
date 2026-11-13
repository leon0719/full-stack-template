import pytest
from django.test import Client

from apps.articles.models import Article


@pytest.fixture(autouse=True)
def _reset_throttle_counters():
    """Throttle counters live in the LocMem cache across tests; clear them so exports never trip ExportThrottle."""
    from django.core.cache import cache

    cache.clear()


def _create(client, headers, **body):
    body.setdefault("title", "Hello")
    return client.post("/articles", data=body, content_type="application/json", headers=headers)


@pytest.mark.integration
def test_create_and_list_article(user, auth_headers):
    client = Client()
    resp = _create(client, auth_headers, title="First", status="draft")
    assert resp.status_code == 201
    assert resp.json()["data"]["owner_id"] == user.id

    listed = client.get("/articles", headers=auth_headers)
    assert listed.status_code == 200
    body = listed.json()["data"]
    assert body["count"] == 1
    assert body["items"][0]["title"] == "First"


@pytest.mark.integration
def test_articles_require_auth(db):
    assert Client().get("/articles").status_code == 401


@pytest.mark.integration
def test_owner_isolation_returns_404(user, auth_headers, other_auth_headers):
    client = Client()
    created = _create(client, auth_headers, title="Mine").json()["data"]

    # Another user must not see or fetch it (IDOR -> 404, not 403/200).
    assert client.get(f"/articles/{created['id']}", headers=other_auth_headers).status_code == 404
    assert client.get("/articles", headers=other_auth_headers).json()["data"]["count"] == 0


@pytest.mark.integration
def test_filter_by_status(user, auth_headers):
    client = Client()
    _create(client, auth_headers, title="d", status="draft")
    _create(client, auth_headers, title="p", status="published")

    resp = client.get("/articles?status=published", headers=auth_headers)
    items = resp.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["status"] == "published"


@pytest.mark.integration
def test_publish_triggers_task(user, auth_headers, monkeypatch, django_capture_on_commit_callbacks):
    """The enqueue is deferred via transaction.on_commit, so capture-and-execute
    the callbacks (tests run inside an atomic block where commit never happens)."""
    calls = []
    monkeypatch.setattr(
        "apps.articles.views.notify_article_published.delay",
        lambda article_id: calls.append(article_id),
    )
    client = Client()
    created = _create(client, auth_headers, title="draft", status="draft").json()["data"]

    with django_capture_on_commit_callbacks(execute=True):
        resp = client.patch(
            f"/articles/{created['id']}",
            data={"status": "published"},
            content_type="application/json",
            headers=auth_headers,
        )
    assert resp.status_code == 200
    assert calls == [created["id"]]

    # Editing an already-published article must NOT re-trigger the side-effect —
    # only the draft→published transition does.
    with django_capture_on_commit_callbacks(execute=True):
        resp = client.patch(
            f"/articles/{created['id']}",
            data={"title": "new title"},
            content_type="application/json",
            headers=auth_headers,
        )
    assert resp.status_code == 200
    assert calls == [created["id"]]


@pytest.mark.integration
def test_patch_without_field_does_not_clear_it(user, auth_headers):
    client = Client()
    created = _create(client, auth_headers, title="keep me", content="body").json()["data"]

    resp = client.patch(
        f"/articles/{created['id']}",
        data={"content": "changed"},
        content_type="application/json",
        headers=auth_headers,
    )
    body = resp.json()["data"]
    assert resp.status_code == 200
    assert body["title"] == "keep me"  # exclude_unset: omitted fields untouched
    assert body["content"] == "changed"


@pytest.mark.integration
def test_page_size_is_capped_at_max(user, auth_headers, settings):
    # Real HTTP path: the view's paginator (created at import time with the
    # real MAX_PAGE_SIZE) must cap an oversized ?page_size=.
    total = settings.MAX_PAGE_SIZE + 5
    Article.objects.bulk_create(Article(owner=user, title=f"a{i}") for i in range(total))

    resp = Client().get("/articles?page_size=99999", headers=auth_headers)

    assert resp.status_code == 200
    body = resp.json()["data"]
    assert body["count"] == total
    assert len(body["items"]) == settings.MAX_PAGE_SIZE  # capped, not 99999


@pytest.mark.integration
def test_delete_article(user, auth_headers):
    client = Client()
    created = _create(client, auth_headers, title="bye").json()["data"]
    resp = client.delete(f"/articles/{created['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert not Article.objects.filter(id=created["id"]).exists()


@pytest.mark.integration
def test_publish_transition_is_claimed_exactly_once(user):
    """The draft→published transition is claimed atomically (rows-affected UPDATE):
    of two racing updates, only one may report just_published=True."""
    from apps.articles.schema import ArticleUpdateRequest
    from apps.articles.services import ArticleService

    article = Article.objects.create(owner=user, title="race", status=Article.Status.DRAFT)
    payload = ArticleUpdateRequest.model_validate({"status": "published"})  # only status set (PATCH semantics)

    _, first = ArticleService.update_owned(user, article.pk, payload)
    _, second = ArticleService.update_owned(user, article.pk, payload)

    assert first is True
    assert second is False  # already claimed — the side effect must not re-fire
    article.refresh_from_db()
    assert article.status == Article.Status.PUBLISHED


# ==================== external_services (webhook) ====================


@pytest.fixture
def _no_sleep(monkeypatch):
    """Neutralise tenacity's exponential backoff so retry tests run instantly."""
    import time

    monkeypatch.setattr(time, "sleep", lambda _s: None)


@pytest.fixture
def webhook_calls(monkeypatch):
    """Capture httpx.post calls made by external_services; returns the call list."""
    import httpx

    calls: list[dict] = []

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr("apps.articles.external_services.httpx.post", fake_post)
    return calls


@pytest.mark.unit
def test_webhook_skipped_when_url_not_configured(webhook_calls, settings):
    from apps.articles.external_services import notify_article_published_webhook

    settings.ARTICLE_PUBLISHED_WEBHOOK_URL = ""  # empty string = disabled
    notify_article_published_webhook(1, "Hello")

    assert webhook_calls == []


@pytest.mark.unit
def test_webhook_posts_payload_when_configured(webhook_calls, settings):
    from apps.articles.external_services import notify_article_published_webhook

    settings.ARTICLE_PUBLISHED_WEBHOOK_URL = "https://hooks.example.com/published"
    notify_article_published_webhook(42, "Hello", event_id="task-uuid-1")

    assert len(webhook_calls) == 1
    call = webhook_calls[0]
    assert call["url"] == "https://hooks.example.com/published"
    # event_id is the at-least-once dedup key (the Celery task id — stable
    # across retries and broker re-deliveries).
    assert call["json"] == {
        "event": "article.published",
        "event_id": "task-uuid-1",
        "article_id": 42,
        "title": "Hello",
    }


@pytest.mark.unit
def test_webhook_http_error_is_graceful(monkeypatch, settings):
    """A 5xx from the webhook endpoint must be swallowed (logged), never raised."""
    import httpx

    from apps.articles.external_services import notify_article_published_webhook

    settings.ARTICLE_PUBLISHED_WEBHOOK_URL = "https://hooks.example.com/published"
    monkeypatch.setattr(
        "apps.articles.external_services.httpx.post",
        lambda url, **kw: httpx.Response(500, request=httpx.Request("POST", url)),
    )

    assert notify_article_published_webhook(1, "Hello") is None  # no exception


@pytest.mark.unit
def test_webhook_connect_error_is_graceful_after_retries(_no_sleep, monkeypatch, settings):
    """Transient transport errors are retried, then swallowed by the graceful wrapper."""
    import httpx

    from apps.articles.external_services import notify_article_published_webhook

    settings.ARTICLE_PUBLISHED_WEBHOOK_URL = "https://hooks.example.com/published"
    calls: list[int] = []

    def always_refuses(url, **kwargs):
        calls.append(1)
        raise httpx.ConnectError("refused", request=httpx.Request("POST", url))

    monkeypatch.setattr("apps.articles.external_services.httpx.post", always_refuses)

    assert notify_article_published_webhook(1, "Hello") is None  # no exception
    assert len(calls) == 3  # default max_retries exhausted before degrading


# ==================== export ====================


@pytest.mark.integration
def test_export_xlsx_contains_only_own_articles(user, other_user, auth_headers):
    import io

    from openpyxl import load_workbook

    Article.objects.create(owner=user, title="我的文章", status=Article.Status.PUBLISHED)
    Article.objects.create(owner=other_user, title="別人的文章")

    resp = Client().get("/articles/export?format=xlsx", headers=auth_headers)

    assert resp.status_code == 200
    assert resp["Content-Type"].startswith("application/vnd.openxmlformats")
    assert "filename*=UTF-8''%E6%96%87%E7%AB%A0_" in resp["Content-Disposition"]
    ws = load_workbook(io.BytesIO(resp.content)).active
    titles = [row[1] for row in ws.iter_rows(min_row=2, values_only=True)]
    assert titles == ["我的文章"]


@pytest.mark.integration
@pytest.mark.parametrize(("fmt", "magic"), [("pdf", b"%PDF"), ("zip", b"PK")])
def test_export_pdf_and_zip(user, auth_headers, fmt, magic):
    Article.objects.create(owner=user, title="中文標題")
    resp = Client().get(f"/articles/export?format={fmt}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.content.startswith(magic)


@pytest.mark.integration
def test_export_respects_filters_and_records_audit(user, auth_headers):
    from apps.audit.models import AuditLog

    Article.objects.create(owner=user, title="d", status=Article.Status.DRAFT)
    Article.objects.create(owner=user, title="p", status=Article.Status.PUBLISHED)

    resp = Client().get("/articles/export?format=xlsx&status=published", headers=auth_headers)

    assert resp.status_code == 200
    entry = AuditLog.objects.get(action=AuditLog.Action.EXPORT)
    assert entry.actor_id == user.id
    assert entry.target_type == "articles.article"
    assert entry.metadata["rows"] == 1
    assert entry.metadata["format"] == "xlsx"


@pytest.mark.integration
def test_export_too_large_returns_422_envelope(user, auth_headers, settings):
    settings.EXPORT_MAX_ROWS = 1
    Article.objects.bulk_create(Article(owner=user, title=f"a{i}") for i in range(2))

    resp = Client().get("/articles/export", headers=auth_headers)

    assert resp.status_code == 422
    assert resp.json()["error"]["reason"] == "export_too_large"


@pytest.mark.integration
def test_export_requires_auth_and_valid_format(user, auth_headers):
    assert Client().get("/articles/export").status_code == 401
    assert Client().get("/articles/export?format=csv", headers=auth_headers).status_code == 422


# ==================== business audit on writes ====================


@pytest.mark.integration
def test_article_writes_are_audited(user, auth_headers):
    from apps.audit.models import AuditLog

    client = Client()
    created = _create(client, auth_headers, title="v1").json()["data"]
    client.patch(
        f"/articles/{created['id']}",
        data={"title": "v2"},
        content_type="application/json",
        headers=auth_headers,
    )
    client.delete(f"/articles/{created['id']}", headers=auth_headers)

    entries = list(AuditLog.objects.filter(target_type="articles.article", target_id=str(created["id"])).order_by("id"))
    assert [e.action for e in entries] == ["create", "update", "delete"]
    assert entries[0].changes is not None
    assert entries[0].changes["title"] == [None, "v1"]
    assert entries[1].changes == {"title": ["v1", "v2"]}
    assert entries[2].changes is not None
    assert entries[2].changes["title"] == ["v2", None]  # hard delete: every field goes to None
    assert all(e.actor_id == user.id and e.metadata.get("ip") == "127.0.0.1" for e in entries)


@pytest.mark.integration
def test_export_filename_header_is_exposed_to_the_cross_origin_frontend(user, auth_headers):
    resp = Client().get("/articles/export", headers={**auth_headers, "Origin": "http://localhost:5173"})

    assert resp.status_code == 200
    assert resp["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert "content-disposition" in resp["Access-Control-Expose-Headers"].lower()
