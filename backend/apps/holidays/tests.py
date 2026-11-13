import json
from datetime import date

import httpx
import pytest
from django.core.management import CommandError, call_command

from apps.holidays.models import Holiday
from apps.holidays.services import import_calendar, is_working_day, next_working_day
from apps.holidays.utils import parse_calendar

# 2026-10-09 (Fri) 國慶日調整放假; 2026-10-10 (Sat) 國慶日; 2026-10-12 (Mon) 一般上班;
# 2026-02-07 (Sat) 假設的補班日 — 涵蓋「平日放假」「週末本來就放」「週末補班」三種。
CALENDAR = [
    {"date": "20261009", "week": "五", "isHoliday": True, "description": "國慶日調整放假"},
    {"date": "20261010", "week": "六", "isHoliday": True, "description": "國慶日"},
    {"date": "20261012", "week": "一", "isHoliday": False, "description": ""},
    {"date": "20260207", "week": "六", "isHoliday": False, "description": "補行上班"},
]


@pytest.mark.unit
def test_parse_calendar_keeps_only_exceptions_to_default_rule():
    overrides = parse_calendar(CALENDAR)
    assert [(o.day, o.is_holiday, o.name) for o in overrides] == [
        (date(2026, 10, 9), True, "國慶日調整放假"),
        (date(2026, 2, 7), False, "補行上班"),
    ]


@pytest.mark.unit
@pytest.mark.parametrize(
    "row", [{"date": "2026-10-09", "isHoliday": True}, {"date": "20261009"}, {"date": "20261009", "isHoliday": "yes"}]
)
def test_parse_calendar_rejects_malformed_rows(row):
    with pytest.raises(ValueError):
        parse_calendar([row])


@pytest.mark.integration
def test_is_working_day_uses_overrides_then_weekday_rule(db):
    import_calendar(CALENDAR)

    assert is_working_day(date(2026, 10, 9)) is False  # weekday holiday
    assert is_working_day(date(2026, 10, 10)) is False  # plain Saturday
    assert is_working_day(date(2026, 10, 12)) is True  # plain Monday
    assert is_working_day(date(2026, 2, 7)) is True  # make-up Saturday


@pytest.mark.integration
def test_next_working_day_skips_long_weekend(db):
    import_calendar(CALENDAR)
    assert next_working_day(date(2026, 10, 8)) == date(2026, 10, 12)  # Fri holiday + weekend
    assert next_working_day(date(2026, 10, 12), include_today=True) == date(2026, 10, 12)
    assert next_working_day(date(2026, 2, 6)) == date(2026, 2, 7)  # make-up Saturday counts


@pytest.mark.integration
def test_import_calendar_is_idempotent_and_updates(db):
    assert import_calendar(CALENDAR) == (2, 0)
    renamed = [{**CALENDAR[0], "description": "改名"}]
    assert import_calendar(renamed) == (0, 1)
    assert Holiday.objects.get(day=date(2026, 10, 9)).name == "改名"


@pytest.mark.integration
def test_import_holidays_command_from_file(db, tmp_path):
    path = tmp_path / "2026.json"
    path.write_text(json.dumps(CALENDAR, ensure_ascii=False), encoding="utf-8")

    call_command("import_holidays", "2026", "--file", str(path))

    assert Holiday.objects.count() == 2


@pytest.mark.integration
def test_import_holidays_command_rejects_wrong_year_and_bad_file(db, tmp_path):
    path = tmp_path / "x.json"
    path.write_text(json.dumps(CALENDAR), encoding="utf-8")
    with pytest.raises(CommandError, match="2027"):
        call_command("import_holidays", "2027", "--file", str(path))
    with pytest.raises(CommandError):
        call_command("import_holidays", "2026", "--file", str(tmp_path / "missing.json"))
    assert not Holiday.objects.exists()


@pytest.mark.integration
def test_import_holidays_command_fetches_online(db, monkeypatch):
    """Network is mocked: the real CDN is never called in tests."""
    calls: list[str] = []

    def fake_get(url, **kwargs):
        calls.append(url)
        return httpx.Response(200, json=CALENDAR, request=httpx.Request("GET", url))

    monkeypatch.setattr("apps.holidays.external_services.httpx.get", fake_get)
    call_command("import_holidays", "2026")

    assert calls == ["https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/2026.json"]
    assert Holiday.objects.count() == 2


@pytest.mark.integration
def test_import_holidays_command_reports_unpublished_year(db, monkeypatch):
    monkeypatch.setattr(
        "apps.holidays.external_services.httpx.get",
        lambda url, **kw: httpx.Response(404, request=httpx.Request("GET", url)),
    )
    with pytest.raises(CommandError, match="尚未公告"):
        call_command("import_holidays", "2030")
