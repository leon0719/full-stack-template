"""純函式:預設的工作日規則與行事曆資料解析。不碰 DB。"""

from collections.abc import Iterable
from datetime import date, datetime
from typing import Any, NamedTuple

_NAME_MAX = 50


class CalendarOverride(NamedTuple):
    day: date
    name: str
    is_holiday: bool


def is_default_working_day(day: date) -> bool:
    """沒有例外時的規則:週一到週五上班。"""
    return day.weekday() < 5


def parse_calendar(rows: Iterable[dict[str, Any]]) -> list[CalendarOverride]:
    """把人事行政總處辦公日曆(每天一筆)轉成「與預設規則不同的日子」。

    每筆格式:``{"date": "YYYYMMDD", "isHoliday": bool, "description": str}``
    (github.com/ruyut/TaiwanCalendar 整理的 JSON,欄位同政府資料開放平臺的 CSV)。
    格式不符直接丟 ``ValueError``——寧可匯入失敗,也不要默默寫進錯的假日。
    """
    overrides: list[CalendarOverride] = []
    for row in rows:
        try:
            day = datetime.strptime(str(row["date"]), "%Y%m%d").date()  # noqa: DTZ007 — 純日期,無時區
            is_holiday = row["isHoliday"]
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"unexpected calendar row: {row!r}") from exc
        if not isinstance(is_holiday, bool):
            raise ValueError(f"isHoliday must be a boolean: {row!r}")
        if is_holiday == is_default_working_day(day):  # 平日放假,或週末上班
            name = str(row.get("description") or ("放假" if is_holiday else "補班"))[:_NAME_MAX]
            overrides.append(CalendarOverride(day, name, is_holiday))
    return overrides
