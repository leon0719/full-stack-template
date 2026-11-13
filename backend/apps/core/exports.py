"""檔案匯出:xlsx(openpyxl)、中文 PDF(reportlab)、多檔 ZIP,以及下載回應。

產生檔案的函式都是純函式(輸入表頭 + 列,輸出 bytes),不碰 DB/HTTP,業務 service 組好資料
後呼叫即可;``attachment_response`` 是給 views.py 用的 HTTP 包裝。範例見
``apps/articles``(``GET /api/v1/articles/export``)。

資料量:整份檔案在記憶體裡組完才回應。同步端點要用 ``EXPORT_MAX_ROWS`` 擋住大量資料,
更大的匯出改成背景 job(``apps/jobs``)產生後再下載。
"""

import io
import re
import zipfile
from collections.abc import Iterable, Sequence
from datetime import date, datetime
from pathlib import Path
from urllib.parse import quote

from django.http import HttpResponse
from django.utils import timezone
from loguru import logger
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PDF_CONTENT_TYPE = "application/pdf"
ZIP_CONTENT_TYPE = "application/zip"

Cell = str | int | float | bool | date | datetime | None
Row = Sequence[Cell]

# ---------------------------------------------------------------------------
# xlsx
# ---------------------------------------------------------------------------
_HEADER_FONT = Font(bold=True, color="FFFFFF")
_HEADER_FILL = PatternFill("solid", fgColor="305496")
_MIN_COL_WIDTH = 8
_MAX_COL_WIDTH = 60


def _display_width(value: Cell) -> int:
    """估計 Excel 欄寬:全形(中日韓)字算 2 格,其餘 1 格。"""
    text = "" if value is None else str(value)
    return sum(2 if ord(ch) > 0x2E7F else 1 for ch in text)


def _xlsx_value(value: Cell) -> Cell:
    if isinstance(value, str):
        # openpyxl 遇到控制字元會直接拋錯;使用者輸入的文字什麼都可能有。
        return ILLEGAL_CHARACTERS_RE.sub("", value)
    if isinstance(value, datetime) and value.tzinfo is not None:
        # Excel 不支援時區:轉成本地時間(TIME_ZONE)後去掉 tzinfo,數值才會是使用者看到的時間。
        return timezone.localtime(value).replace(tzinfo=None)
    return value


def build_xlsx(headers: Sequence[str], rows: Iterable[Row], *, sheet_title: str = "Sheet1") -> bytes:
    """單一工作表:粗體白字深底的標題列、凍結標題、依內容自動估算欄寬。

    以 ``=`` ``+`` ``-`` ``@`` 開頭的字串一律存成文字而不是公式(CSV/Formula injection:
    使用者輸入 ``=HYPERLINK(...)`` 在別人打開檔案時被執行)。
    """
    wb = Workbook()
    ws = wb.active
    assert ws is not None  # noqa: S101 — 新 Workbook 一定有 active sheet,給 mypy 收窄型別
    ws.title = sheet_title[:31]  # Excel 工作表名稱上限 31 字
    ws.append(list(headers))
    widths = [_display_width(h) for h in headers]
    for row in rows:
        values = [_xlsx_value(v) for v in row]
        ws.append(values)
        for i, v in enumerate(values):
            widths[i] = max(widths[i], _display_width(v))
    for cell in ws[1]:
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center")
    for row_cells in ws.iter_rows(min_row=2):
        for cell in row_cells:
            if isinstance(cell.value, str) and cell.value[:1] in ("=", "+", "-", "@"):
                cell.data_type = "s"
            elif isinstance(cell.value, datetime):
                cell.number_format = "yyyy-mm-dd hh:mm"
    for i, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = min(max(width + 2, _MIN_COL_WIDTH), _MAX_COL_WIDTH)
    ws.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# PDF(中文)
# ---------------------------------------------------------------------------
# 嵌入 AR PL UMing TW(Dockerfile 的 fonts-arphic-uming)。不能用 fonts-noto-cjk:它是 CFF
# (PostScript)外框的 OpenType,reportlab 只支援 TrueType 外框,註冊時會丟
# "postscript outlines are not supported"。subfontIndex 2 = UMingTW(0 是簡體字形 CN)。
CJK_FONT_FILE = Path("/usr/share/fonts/truetype/arphic/uming.ttc")
_CJK_SUBFONT_INDEX = 2
_EMBEDDED_FONT = "UMingTW"
# 找不到字型檔時(例如 macOS 本機開發)退回 reportlab 內建的 CID 字型:不嵌入字型,靠閱讀器
# 自己找替代字,部分閱讀器(如 Chrome)會有字空白——只適合開發時看版面,prod image 一定有字型檔。
_FALLBACK_FONT = "MSung-Light"
_registered_font: str | None = None


def cjk_font_name() -> str:
    """註冊(每個 process 只做一次)並回傳可顯示繁體中文的字型名稱。"""
    global _registered_font  # process 內快取:避免每次匯出都重讀 20MB 字型檔
    if _registered_font is None:
        if CJK_FONT_FILE.exists():
            pdfmetrics.registerFont(TTFont(_EMBEDDED_FONT, str(CJK_FONT_FILE), subfontIndex=_CJK_SUBFONT_INDEX))
            _registered_font = _EMBEDDED_FONT
        else:
            logger.warning("[Export] CJK font file not found, falling back to CID font - path: {p}", p=CJK_FONT_FILE)
            pdfmetrics.registerFont(UnicodeCIDFont(_FALLBACK_FONT))
            _registered_font = _FALLBACK_FONT
    return _registered_font


def _pdf_text(value: Cell) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return timezone.localtime(value).strftime("%Y-%m-%d %H:%M") if value.tzinfo else value.isoformat(" ")
    return str(value)


def build_pdf_table(
    title: str,
    headers: Sequence[str],
    rows: Iterable[Row],
    *,
    col_widths_mm: Sequence[float] | None = None,
) -> bytes:
    """A4 橫式、標題 + 表格(表頭每頁重複)。儲存格用 Paragraph,長文字會自動換行。"""
    font = cjk_font_name()
    cell_style = ParagraphStyle("cell", fontName=font, fontSize=9, leading=12, wordWrap="CJK")
    head_style = ParagraphStyle("head", parent=cell_style, textColor=colors.white)
    title_style = ParagraphStyle("title", fontName=font, fontSize=16, leading=20)

    def para(text: str, style: ParagraphStyle) -> Paragraph:
        # Paragraph 吃的是迷你 HTML:使用者文字裡的 < & 不跳脫會被當成標記(版面錯亂或直接丟例外)。
        escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
        return Paragraph(escaped, style)

    data = [[para(h, head_style) for h in headers]]
    data += [[para(_pdf_text(v), cell_style) for v in row] for row in rows]
    table = Table(
        data,
        colWidths=[w * mm for w in col_widths_mm] if col_widths_mm else None,
        repeatRows=1,
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#305496")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F2F2F2")]),
            ]
        )
    )
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
        title=title,
    )
    doc.build([para(title, title_style), Spacer(1, 6 * mm), table])
    return buf.getvalue()


# ---------------------------------------------------------------------------
# ZIP
# ---------------------------------------------------------------------------
def build_zip(files: dict[str, bytes]) -> bytes:
    """多個檔案打包成一個 zip。檔名用 UTF-8(zipfile 遇到非 ASCII 檔名會自動設 UTF-8 旗標)。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(safe_filename(name), content)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# 下載回應
# ---------------------------------------------------------------------------
_UNSAFE_FILENAME = re.compile(r'[\x00-\x1f\x7f/\\:*?"<>|]+')


def safe_filename(name: str) -> str:
    """去掉路徑分隔與控制字元(header injection、zip slip),保留中文。"""
    cleaned = _UNSAFE_FILENAME.sub("_", name).strip(" .")
    return cleaned or "download"


def content_disposition(filename: str) -> str:
    """``attachment; filename="<ASCII 備援>"; filename*=UTF-8''<百分比編碼>``(RFC 6266 / RFC 5987)。

    新瀏覽器讀 ``filename*`` 拿到中文檔名;不懂的舊 client 退回 ASCII 的 ``filename``。
    """
    name = safe_filename(filename)
    ascii_fallback = name.encode("ascii", "ignore").decode() or "download"
    if ascii_fallback.startswith("."):  # 例如「文章.xlsx」只剩 ".xlsx"
        ascii_fallback = "download" + ascii_fallback
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(name, safe='')}"


def attachment_response(content: bytes, filename: str, content_type: str) -> HttpResponse:
    """下載用的 HttpResponse(給 views.py)。不包 BaseResponse:client 拿到的就是檔案本身。"""
    response = HttpResponse(content, content_type=content_type)
    response["Content-Disposition"] = content_disposition(filename)
    response["Content-Length"] = str(len(content))
    # 匯出內容是個人資料,不讓中間的 proxy/瀏覽器快取。
    response["Cache-Control"] = "no-store"
    return response


def export_filename(stem: str, ext: str, *, now: datetime | None = None) -> str:
    """``<stem>_<本地時間 YYYYmmdd_HHMMSS>.<ext>``。"""
    stamp = timezone.localtime(now or timezone.now()).strftime("%Y%m%d_%H%M%S")
    return f"{stem}_{stamp}.{ext}"
