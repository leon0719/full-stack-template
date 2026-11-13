"""台灣工作日判斷。業務程式只需要 ``is_working_day`` / ``next_working_day``。"""

from collections.abc import Iterable
from datetime import date, timedelta
from typing import Any

from django.db import transaction
from loguru import logger

from apps.holidays.models import Holiday
from apps.holidays.utils import is_default_working_day, parse_calendar

# next_working_day 往後找的上限:台灣最長連假(春節+調整放假)約 9-10 天,60 天綽綽有餘;
# 超過代表資料有誤(例如誤把整段期間都設成假日),寧可丟錯也不要無窮迴圈。
_MAX_LOOKAHEAD_DAYS = 60


def is_working_day(day: date) -> bool:
    """這天要不要上班:先看 ``Holiday`` 例外表,沒有就照「週一到週五」。"""
    override = Holiday.objects.filter(day=day).values_list("is_holiday", flat=True).first()
    if override is not None:
        return not override
    return is_default_working_day(day)


def next_working_day(day: date, *, include_today: bool = False) -> date:
    """``day`` 之後(``include_today=True`` 時含當天)的第一個工作日。一次查詢載入整段例外。"""
    start = day if include_today else day + timedelta(days=1)
    end = start + timedelta(days=_MAX_LOOKAHEAD_DAYS)
    overrides = dict(Holiday.objects.filter(day__gte=start, day__lt=end).values_list("day", "is_holiday"))
    current = start
    while current < end:
        is_holiday = overrides.get(current)
        working = is_default_working_day(current) if is_holiday is None else not is_holiday
        if working:
            return current
        current += timedelta(days=1)
    raise ValueError(f"no working day within {_MAX_LOOKAHEAD_DAYS} days after {day}")


def import_calendar(rows: Iterable[dict[str, Any]]) -> tuple[int, int]:
    """匯入行事曆,回傳 ``(新增, 更新)``。可重複執行:同一天以新資料覆寫(政府修正行事曆時重跑即可)。"""
    overrides = parse_calendar(rows)
    created = updated = 0
    with transaction.atomic():
        for item in overrides:
            _, was_created = Holiday.objects.update_or_create(
                day=item.day, defaults={"name": item.name, "is_holiday": item.is_holiday}
            )
            created += was_created
            updated += not was_created
    logger.info("[Service] holidays imported - created: {c}, updated: {u}", c=created, u=updated)
    return created, updated
