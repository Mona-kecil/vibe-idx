from __future__ import annotations

import datetime as dt

from idx_ingest.cli import _date_range


def test_date_range_defaults_to_single_latest_day() -> None:
    today = dt.date.today()
    assert _date_range(None, None) == (today, today)


def test_date_range_accepts_one_sided_historical_date() -> None:
    date = dt.date(2026, 6, 25)
    assert _date_range("2026-06-25", None) == (date, date)
    assert _date_range(None, "20260625") == (date, date)
