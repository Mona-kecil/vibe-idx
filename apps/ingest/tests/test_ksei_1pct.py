from __future__ import annotations

import datetime as dt
from decimal import Decimal

from idx_ingest.parsers import parse_ksei_1pct_text


def test_parse_ksei_1pct_clean_table_rows() -> None:
    report = parse_ksei_1pct_text(
        "\n".join(
            [
                "DATE SHARE_CODE ISSUER_NAME INVESTOR_NAME INVESTOR_CLASSIFICATION",
                "29-May-2026 AADI ADARO ANDALAN INDONESIA Tbk "
                "PERSADA CAPITAL INVESTAMA Corporate L INDONESIA "
                "119.887.170 0 119.887.170 1,54",
                "29-May-2026 AADI ADARO ANDALAN INDONESIA Tbk "
                "GARIBALDI THOHIR Individual L INDONESIAN INDONESIA "
                "454.011.607 0 454.011.607 5,83",
            ]
        ),
        page_count=33,
    )
    assert report.as_of_date == dt.date(2026, 5, 29)
    assert report.page_count == 33
    assert len(report.rows) == 2
    assert report.rows[0].ticker == "AADI"
    assert report.rows[0].issuer_name == "ADARO ANDALAN INDONESIA Tbk"
    assert report.rows[0].investor_name == "PERSADA CAPITAL INVESTAMA"
    assert report.rows[0].holdings_scripless == 119887170
    assert report.rows[0].percentage == Decimal("1.54")
    assert report.rows[1].nationality == "INDONESIAN"
    assert report.rows[1].domicile == "INDONESIA"
