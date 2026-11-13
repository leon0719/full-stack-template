"""台灣辦公日曆(行政院人事行政總處)的抓取。本 app 唯一能用 httpx 的地方。"""

from typing import Any

import httpx
from loguru import logger

from config.external_api_handler import handle_api_call_graceful

# 人事行政總處辦公日曆的 JSON 整理版(github.com/ruyut/TaiwanCalendar),經 jsDelivr CDN,網址依年份固定。
# 官方 CSV 在政府資料開放平臺每年換網址,沒辦法自動抓;不信任這個來源時改用 --file 匯入自己下載的檔案。
CALENDAR_URL = "https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/{year}.json"
_TIMEOUT_SECONDS = 30.0


@handle_api_call_graceful("taiwan-calendar", default_return=None)
def fetch_taiwan_calendar(year: int) -> list[dict[str, Any]] | None:
    """整年每天一筆;抓不到(該年度尚未公告、網路錯誤)回 None,由呼叫端決定怎麼處理。"""
    response = httpx.get(CALENDAR_URL.format(year=year), timeout=_TIMEOUT_SECONDS)
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, list):
        logger.warning("[External] unexpected calendar payload - year: {y}", y=year)
        return None
    return data
