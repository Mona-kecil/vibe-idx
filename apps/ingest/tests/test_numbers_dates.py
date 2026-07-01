from __future__ import annotations

import datetime as dt
from decimal import Decimal

from idx_ingest.util import (
    parse_cli_date,
    parse_decimal,
    parse_filename_date,
    parse_idx_date,
    parse_int,
)


def test_parse_indonesian_numbers() -> None:
    assert parse_int("1.234.567") == 1234567
    assert parse_decimal("1,54") == Decimal("1.54")
    assert parse_int("") is None
    assert parse_decimal("-") is None


def test_parse_dates() -> None:
    assert parse_idx_date("29-May-2026") == dt.date(2026, 5, 29)
    assert parse_idx_date("05 -JUN-2026") == dt.date(2026, 6, 5)
    assert parse_filename_date("20260602_Semua Emiten Saham.pdf") == dt.date(2026, 6, 2)
    assert parse_cli_date("2026-06-02") == dt.date(2026, 6, 2)
    assert parse_cli_date("20260602") == dt.date(2026, 6, 2)
