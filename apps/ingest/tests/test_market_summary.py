from __future__ import annotations

import datetime as dt

from idx_ingest.parsers import (
    parse_long_suspension_events,
    parse_market_summary,
    parse_suspension_events,
)


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


def test_parse_suspension_events_from_idx_endpoint() -> None:
    rows = parse_suspension_events(
        {
            "Results": [
                {
                    "Judul": "Penghentian Sementara Perdagangan Saham PT Test Tbk. (TEST)",
                    "Kode": "TEST",
                    "Date": "2026-07-02T00:00:00",
                    "Info_Type": "SPT",
                    "Data_Download": "/StaticData/Suspensi_TEST.pdf",
                },
                {
                    "Judul": "Pembukaan Kembali Perdagangan Saham PT Open Tbk. (OPEN)",
                    "Kode": "OPEN",
                    "Date": "2026-07-03T10:03:41",
                    "Info_Type": "UPT",
                    "Data_Download": "/StaticData/Unsuspensi_OPEN.pdf",
                },
                {
                    "Judul": "Penghentian Sementara Perdagangan Efek (>1 Kode)",
                    "Kode": ">1 Kode",
                    "Date": "2026-07-03T09:04:38",
                    "Info_Type": "SPT",
                    "Data_Download": "/StaticData/Multi.pdf",
                },
            ]
        },
    )

    assert [row.ticker for row in rows] == ["TEST", "OPEN"]
    assert rows[0].event_type == "SPT"
    assert rows[0].event_at == dt.datetime(2026, 7, 2, 0, 0)
    assert rows[0].attachment_url == "/StaticData/Suspensi_TEST.pdf"
    assert rows[1].event_type == "UPT"


def test_parse_long_suspension_events_from_idx_html_table() -> None:
    rows = parse_long_suspension_events(
        """
        <table>
          <tr>
            <td>2</td>
            <td>ALTO</td>
            <td>PT Tri Banyan Tirta Tbk</td>
            <td>Consumer Non-Cyclicals</td>
            <td>Pemantauan Khusus</td>
            <td>10-Jul-12</td>
            <td>30-Jun-25</td>
            <td>Corporate Secretary</td>
          </tr>
        </table>
        """,
    )

    assert len(rows) == 1
    assert rows[0].ticker == "ALTO"
    assert rows[0].event_type == "SPT"
    assert rows[0].event_at == dt.datetime(2025, 6, 30, 0, 0)
    assert rows[0].title == "Suspensi > 6 Bulan: PT Tri Banyan Tirta Tbk"
