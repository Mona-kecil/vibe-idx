from __future__ import annotations

import datetime as dt

from idx_ingest.parsers import parse_market_summary


def test_parse_market_summary_row() -> None:
    rows = parse_market_summary(
        {
            "data": [
                {
                    "StockCode": "BBCA",
                    "StockName": "BANK CENTRAL ASIA",
                    "OpenPrice": "9000",
                    "High": "9100",
                    "Low": "8900",
                    "Close": "9050",
                    "Volume": "1.234.567",
                    "ForeignBuy": "100",
                    "ForeignSell": "40",
                }
            ]
        },
        dt.date(2026, 6, 5),
    )
    assert rows[0].ticker == "BBCA"
    assert rows[0].volume == 1234567
    assert rows[0].foreign_buy == 100
