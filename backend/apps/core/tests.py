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


# ==================== exports.py ====================


@pytest.mark.unit
def test_build_xlsx_styles_header_sizes_columns_and_neutralises_formulas():
    import io
    from datetime import UTC, datetime

    from openpyxl import load_workbook

    from apps.core.exports import build_xlsx

    content = build_xlsx(
        ["ID", "標題"],
        [
            [1, '=HYPERLINK("http://evil")'],
            [2, "很長的中文標題很長的中文標題\x07"],
            [3, datetime(2026, 1, 2, tzinfo=UTC)],
        ],
        sheet_title="文章",
    )
    ws = load_workbook(io.BytesIO(content)).active
    assert ws.title == "文章"
    assert ws["A1"].font.bold and ws["A1"].fill.fgColor.rgb.endswith("305496")
    assert ws.freeze_panes == "A2"
    assert ws["B2"].data_type == "s"  # stored as text, not a formula
    assert ws["B3"].value == "很長的中文標題很長的中文標題"  # illegal control char stripped
    assert ws.column_dimensions["B"].width >= 28  # CJK counted as double width
    assert ws["B4"].value == datetime(2026, 1, 2)  # noqa: DTZ001 — Excel has no tz: aware → naive local time


@pytest.mark.unit
def test_build_pdf_table_renders_cjk_and_escapes_markup():
    from apps.core.exports import build_pdf_table

    pdf = build_pdf_table("文章清單", ["ID", "標題"], [[1, "<b>不是標記</b> & 中文"]] * 3)
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 1000


@pytest.mark.unit
def test_build_zip_keeps_utf8_names_and_strips_paths():
    import io
    import zipfile

    from apps.core.exports import build_zip

    content = build_zip({"文章.xlsx": b"x", "../../etc/passwd": b"y"})
    names = zipfile.ZipFile(io.BytesIO(content)).namelist()
    assert names[0] == "文章.xlsx"
    assert "/" not in names[1] and not names[1].startswith(".")  # no zip-slip path


@pytest.mark.unit
@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("report.xlsx", "attachment; filename=\"report.xlsx\"; filename*=UTF-8''report.xlsx"),
        (
            "文章_2026.xlsx",
            "attachment; filename=\"_2026.xlsx\"; filename*=UTF-8''%E6%96%87%E7%AB%A0_2026.xlsx",
        ),
        ("文章.pdf", "attachment; filename=\"download.pdf\"; filename*=UTF-8''%E6%96%87%E7%AB%A0.pdf"),
        ('a"b\r\nX-Evil: 1.pdf', "attachment; filename=\"a_b_X-Evil_ 1.pdf\"; filename*=UTF-8''a_b_X-Evil_%201.pdf"),
    ],
)
def test_content_disposition_rfc5987(filename, expected):
    from apps.core.exports import content_disposition

    assert content_disposition(filename) == expected


@pytest.mark.unit
def test_attachment_response_headers():
    from apps.core.exports import PDF_CONTENT_TYPE, attachment_response

    resp = attachment_response(b"%PDF-1.4", "文章.pdf", PDF_CONTENT_TYPE)
    assert resp["Content-Type"] == PDF_CONTENT_TYPE
    assert resp["Content-Length"] == "8"
    assert resp["Cache-Control"] == "no-store"
    assert "filename*=UTF-8''" in resp["Content-Disposition"]


@pytest.mark.unit
def test_export_throttle_has_its_own_cache_scope():
    from apps.core.throttling import ExportThrottle, WriteRateThrottle

    assert ExportThrottle().scope != WriteRateThrottle().scope
