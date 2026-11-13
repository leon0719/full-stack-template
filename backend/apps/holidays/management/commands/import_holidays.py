"""匯入台灣辦公日曆(行政院人事行政總處)到 Holiday 表。

    uv run python manage.py import_holidays 2027              # 從網路抓(見 external_services.CALENDAR_URL)
    uv run python manage.py import_holidays 2027 --file 2027.json   # 用自己下載的檔案,不連網

可重複執行(同一天覆寫)。人事行政總處通常在前一年 6 月左右公告隔年行事曆;公告前抓不到。
"""

import json
from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from apps.holidays.external_services import fetch_taiwan_calendar
from apps.holidays.services import import_calendar


class Command(BaseCommand):
    help = "Import the Taiwan government office calendar (holidays and make-up workdays) for a year."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("year", type=int, help="西元年,例如 2027")
        parser.add_argument("--file", type=Path, help="改從本機 JSON 檔匯入(格式同線上資料),不連網")

    def handle(self, *args: Any, **options: Any) -> None:
        year: int = options["year"]
        path: Path | None = options["file"]
        if path is not None:
            try:
                rows = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise CommandError(f"讀不到行事曆檔案 {path}: {exc}") from exc
        else:
            rows = fetch_taiwan_calendar(year)
            if rows is None:
                raise CommandError(f"抓不到 {year} 年的辦公日曆(可能尚未公告),可改用 --file 匯入")
        if not isinstance(rows, list) or not rows:
            raise CommandError("行事曆資料是空的或格式不對(預期是每天一筆的 JSON 陣列)")
        if any(not str(row.get("date", "")).startswith(str(year)) for row in rows if isinstance(row, dict)):
            raise CommandError(f"資料裡有不屬於 {year} 年的日期,請確認檔案")
        try:
            created, updated = import_calendar(rows)
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(f"{year} 年:新增 {created} 筆、更新 {updated} 筆例外日"))
