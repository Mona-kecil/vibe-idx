from __future__ import annotations

import datetime as dt
import sqlite3
from dataclasses import replace
from pathlib import Path

from idx_ingest import ingest
from idx_ingest.ingest import Settings
from idx_ingest.models import (
    InsiderReport,
    KseiFivePctReport,
    KseiFivePctRow,
    KseiOnePctReport,
    KseiOnePctRow,
    MonthlyOwnershipSnapshot,
)
from idx_ingest.sources import SOURCES


def test_latest_ksei_5pct_uses_first_available_listing_not_today(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'vibe_idx.sqlite'}",
        raw_dir=tmp_path / "raw",
    )
    monkeypatch.setattr(
        ingest,
        "fetch_json",
        lambda url: {
            "items": [
                {
                    "Description": "Pemegang Saham di Atas 5% per 30 Juni 2026",
                    "Prospectus": "https://idx.test/latest.xlsx",
                    "ListingDate": "2026-06-30T12:00:00",
                },
                {
                    "Description": "Pemegang Saham di Atas 5% per 29 Juni 2026",
                    "Prospectus": "https://idx.test/older.xlsx",
                    "ListingDate": "2026-06-29T12:00:00",
                },
            ]
        },
    )
    monkeypatch.setattr(ingest, "fetch_bytes", lambda url, accept="*/*": url.encode())
    monkeypatch.setattr(
        ingest,
        "parse_ksei_5pct_xlsx",
        lambda xlsx, as_of_date, source_date: KseiFivePctReport(
            as_of_date=as_of_date,
            source_date=source_date,
            rows=[KseiFivePctRow(ticker="BBCA", issuer_name=xlsx.decode())],
        ),
    )

    result = ingest.ingest_latest_ksei_5pct(dt.date(2026, 7, 2), settings=settings)

    assert result == {"reports": 1, "rows": 1}
    with sqlite3.connect(tmp_path / "vibe_idx.sqlite") as conn:
        row = conn.execute(
            """
            SELECT r.as_of_date, item.ticker, item.issuer_name
            FROM ksei_5pct_reports AS r
            JOIN ksei_5pct_rows AS item ON item.report_id = r.id
            """
        ).fetchone()
    assert row == ("2026-06-30", "BBCA", "https://idx.test/latest.xlsx")


def test_latest_ksei_5pct_persists_account_holder_shareholder_and_account_distinct(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'vibe_idx.sqlite'}",
        raw_dir=tmp_path / "raw",
    )
    monkeypatch.setattr(
        ingest,
        "fetch_json",
        lambda url: {
            "items": [
                {
                    "Description": "Pemegang Saham di Atas 5% per 30 Juni 2026",
                    "Prospectus": "https://idx.test/latest.xlsx",
                    "ListingDate": "2026-06-30T12:00:00",
                }
            ]
        },
    )
    monkeypatch.setattr(ingest, "fetch_bytes", lambda url, accept="*/*": b"xlsx")
    monkeypatch.setattr(
        ingest,
        "parse_ksei_5pct_xlsx",
        lambda xlsx, as_of_date, source_date: KseiFivePctReport(
            as_of_date=as_of_date,
            source_date=source_date,
            rows=[
                KseiFivePctRow(
                    ticker="AADI",
                    issuer_name="ADARO ANDALAN INDONESIA Tbk, PT",
                    account_holder_name="CITIBANK, N. A",
                    shareholder_name="ADARO STRATEGIC INVESTMENTS",
                    account_name="BOS LTD S/A PT ADARO STRATEGIC INVESTMENTS",
                )
            ],
        ),
    )

    result = ingest.ingest_latest_ksei_5pct(dt.date(2026, 7, 2), settings=settings)

    assert result == {"reports": 1, "rows": 1}
    with sqlite3.connect(tmp_path / "vibe_idx.sqlite") as conn:
        row = conn.execute(
            """
            SELECT account_holder_name, shareholder_name, account_name
            FROM ksei_5pct_rows
            """
        ).fetchone()
    assert row == (
        "CITIBANK, N. A",
        "ADARO STRATEGIC INVESTMENTS",
        "BOS LTD S/A PT ADARO STRATEGIC INVESTMENTS",
    )


def test_latest_market_summary_walks_back_to_populated_eod_snapshot(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'vibe_idx.sqlite'}",
        raw_dir=tmp_path / "raw",
    )
    market_rows = [
        {
            "StockCode": f"T{index:03d}",
            "StockName": f"Ticker {index}",
            "Close": "100",
            "Volume": "10",
        }
        for index in range(801)
    ]

    def fetch_json(url: str) -> dict:
        if "date=20260702" in url:
            return {"data": []}
        if "date=20260701" in url:
            return {"data": market_rows}
        raise AssertionError(f"unexpected URL {url}")

    monkeypatch.setattr(ingest, "fetch_json", fetch_json)

    result = ingest.ingest_latest_market_summary(
        dt.date(2026, 7, 2),
        settings=settings,
    )

    assert result == {"trade_date": "2026-07-01", "rows": 801}
    with sqlite3.connect(tmp_path / "vibe_idx.sqlite") as conn:
        row = conn.execute(
            "SELECT trade_date, COUNT(*) FROM daily_prices GROUP BY trade_date"
        ).fetchone()
    assert row == ("2026-07-01", 801)


def test_latest_ksei_1pct_ingests_first_matching_monthly_report(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'vibe_idx.sqlite'}",
        raw_dir=tmp_path / "raw",
    )
    monkeypatch.setattr(
        ingest,
        "fetch_json",
        lambda url: {
            "Replies": [
                {
                    "pengumuman": {
                        "Id2": "unrelated",
                        "JudulPengumuman": "Keterbukaan Informasi terkait 1 Juli",
                        "TglPengumuman": "2026-07-01T09:00:00",
                    },
                    "attachments": [],
                },
                {
                    "pengumuman": {
                        "Id2": "latest-1pct",
                        "JudulPengumuman": "Pemegang Saham di atas 1% (KSEI)",
                        "TglPengumuman": "2026-06-30T18:00:00",
                    },
                    "attachments": [
                        {
                            "OriginalFilename": "latest_lamp1.pdf",
                            "FullSavePath": "https://idx.test/latest-1pct.pdf",
                            "IsAttachment": True,
                        }
                    ],
                },
                {
                    "pengumuman": {
                        "Id2": "older-1pct",
                        "JudulPengumuman": "Pemegang Saham di atas 1% (KSEI)",
                        "TglPengumuman": "2026-05-31T18:00:00",
                    },
                    "attachments": [
                        {
                            "OriginalFilename": "older_lamp1.pdf",
                            "FullSavePath": "https://idx.test/older-1pct.pdf",
                            "IsAttachment": True,
                        }
                    ],
                },
            ]
        },
    )
    monkeypatch.setattr(ingest, "fetch_bytes", lambda url, accept="*/*": url.encode())
    monkeypatch.setattr(
        ingest,
        "parse_ksei_1pct_pdf",
        lambda pdf: KseiOnePctReport(
            as_of_date=dt.date(2026, 6, 30),
            page_count=1,
            rows=[
                KseiOnePctRow(
                    as_of_date=dt.date(2026, 6, 30),
                    ticker="BBCA",
                    issuer_name=pdf.decode(),
                    investor_name="Investor A",
                )
            ],
        ),
    )

    result = ingest.ingest_latest_ksei_1pct(
        dt.date(2026, 7, 2),
        page_size=10,
        settings=settings,
    )

    assert result == {"reports": 1, "rows": 1}
    with sqlite3.connect(tmp_path / "vibe_idx.sqlite") as conn:
        row = conn.execute(
            """
            SELECT r.as_of_date, item.ticker, item.issuer_name
            FROM ksei_1pct_reports AS r
            JOIN ksei_1pct_rows AS item ON item.report_id = r.id
            """
        ).fetchone()
    assert row == ("2026-06-30", "BBCA", "https://idx.test/latest-1pct.pdf")


def test_latest_ksei_1pct_uses_source_policy_lookback_window(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'vibe_idx.sqlite'}",
        raw_dir=tmp_path / "raw",
    )
    urls: list[str] = []

    monkeypatch.setitem(
        SOURCES,
        "ksei-1pct",
        replace(SOURCES["ksei-1pct"], default_lookback_days=30),
    )
    monkeypatch.setattr(
        ingest,
        "fetch_json",
        lambda url: urls.append(url) or {"Replies": []},
    )

    result = ingest.ingest_latest_ksei_1pct(dt.date(2026, 7, 2), settings=settings)

    assert result == {"reports": 0, "rows": 0}
    assert "dateFrom=20260602" in urls[0]
    assert "dateTo=20260702" in urls[0]


def test_latest_insider_ingests_all_reports_from_latest_matching_day(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'vibe_idx.sqlite'}",
        raw_dir=tmp_path / "raw",
    )

    def insider_item(item_id: str, published_at: str, ticker: str, url: str) -> dict:
        return {
            "pengumuman": {
                "Id2": item_id,
                "JudulPengumuman": ingest.INSIDER_TITLE,
                "TglPengumuman": published_at,
                "Kode_Emiten": ticker,
            },
            "attachments": [
                {
                    "OriginalFilename": f"LK-{ticker}.pdf",
                    "FullSavePath": url,
                    "IsAttachment": True,
                }
            ],
        }

    monkeypatch.setattr(
        ingest,
        "fetch_json",
        lambda url: {
            "Replies": [
                insider_item(
                    "latest-a",
                    "2026-07-01T20:00:00",
                    "BBCA",
                    "https://idx.test/From_KSEI/LK-BBCA.pdf",
                ),
                {
                    "pengumuman": {
                        "Id2": "unrelated",
                        "JudulPengumuman": "Laporan Informasi dan Fakta Material",
                        "TglPengumuman": "2026-07-01T19:00:00",
                    },
                    "attachments": [],
                },
                insider_item(
                    "latest-b",
                    "2026-07-01T12:00:00",
                    "BBRI",
                    "https://idx.test/From_KSEI/LK-BBRI.pdf",
                ),
                insider_item(
                    "older",
                    "2026-06-30T20:00:00",
                    "BMRI",
                    "https://idx.test/From_KSEI/LK-BMRI.pdf",
                ),
            ]
        },
    )
    monkeypatch.setattr(ingest, "fetch_bytes", lambda url, accept="*/*": url.encode())
    monkeypatch.setattr(
        ingest,
        "parse_insider_pdf",
        lambda pdf: InsiderReport(ticker=pdf.decode().removesuffix(".pdf").rsplit("-", 1)[-1]),
    )

    result = ingest.ingest_latest_insider(
        dt.date(2026, 7, 2),
        page_size=10,
        settings=settings,
    )

    assert result == {"reports": 2}
    with sqlite3.connect(tmp_path / "vibe_idx.sqlite") as conn:
        rows = conn.execute("SELECT ticker FROM insider_reports ORDER BY ticker").fetchall()
    assert rows == [("BBCA",), ("BBRI",)]


def test_latest_insider_ingests_company_format_lampiran_report(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'vibe_idx.sqlite'}",
        raw_dir=tmp_path / "raw",
    )
    monkeypatch.setattr(
        ingest,
        "fetch_json",
        lambda url: {
            "Replies": [
                {
                    "pengumuman": {
                        "Id2": "bbkp",
                        "JudulPengumuman": (
                            "Laporan Kepemilikan atau Setiap Perubahan Kepemilikan Saham "
                            "PT Bank KB Indonesia Tbk"
                        ),
                        "TglPengumuman": "2026-07-01T11:44:06",
                        "Kode_Emiten": "BBKP",
                    },
                    "attachments": [
                        {
                            "OriginalFilename": (
                                "20260701_BBKP_Laporan Informasi dan Fakta Material.pdf"
                            ),
                            "FullSavePath": "https://idx.test/main.pdf",
                            "IsAttachment": False,
                        },
                        {
                            "OriginalFilename": (
                                "20260701_BBKP_Laporan Informasi dan Fakta Material_lamp1.pdf"
                            ),
                            "FullSavePath": "https://idx.test/bbkp-lamp1.pdf",
                            "IsAttachment": True,
                        },
                    ],
                }
            ]
        },
    )
    monkeypatch.setattr(ingest, "fetch_bytes", lambda url, accept="*/*": url.encode())
    monkeypatch.setattr(
        ingest,
        "parse_insider_pdf",
        lambda pdf: InsiderReport(ticker=pdf.decode().removesuffix(".pdf").rsplit("-", 1)[-1]),
    )

    result = ingest.ingest_latest_insider(
        dt.date(2026, 7, 2),
        page_size=10,
        settings=settings,
    )

    assert result == {"reports": 1}
    with sqlite3.connect(tmp_path / "vibe_idx.sqlite") as conn:
        rows = conn.execute("SELECT ticker FROM insider_reports").fetchall()
    assert rows == [("lamp1",)]


def test_latest_laporan_efek_ingests_first_monthly_snapshot(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'vibe_idx.sqlite'}",
        raw_dir=tmp_path / "raw",
    )
    monkeypatch.setattr(
        ingest,
        "fetch_json",
        lambda url: {
            "Replies": [
                {
                    "pengumuman": {
                        "Id2": "latest-monthly",
                        "JudulPengumuman": "Laporan Bulanan Registrasi Pemegang Efek",
                        "TglPengumuman": "2026-07-01T16:00:00",
                        "Kode_Emiten": "BBCA",
                    },
                    "attachments": [
                        {
                            "OriginalFilename": "BBCA.pdf",
                            "FullSavePath": "https://idx.test/monthly-BBCA.pdf",
                            "IsAttachment": True,
                        }
                    ],
                },
                {
                    "pengumuman": {
                        "Id2": "older-monthly",
                        "JudulPengumuman": "Laporan Bulanan Registrasi Pemegang Efek",
                        "TglPengumuman": "2026-06-30T16:00:00",
                        "Kode_Emiten": "BBRI",
                    },
                    "attachments": [
                        {
                            "OriginalFilename": "BBRI.pdf",
                            "FullSavePath": "https://idx.test/monthly-BBRI.pdf",
                            "IsAttachment": True,
                        }
                    ],
                },
            ]
        },
    )
    monkeypatch.setattr(ingest, "fetch_bytes", lambda url, accept="*/*": url.encode())
    monkeypatch.setattr(
        ingest,
        "parse_laporan_efek_pdf",
        lambda pdf: MonthlyOwnershipSnapshot(
            ticker=pdf.decode().removesuffix(".pdf").rsplit("-", 1)[-1],
            report_month="2026-06",
        ),
    )

    result = ingest.ingest_latest_laporan_efek(
        dt.date(2026, 7, 2),
        page_size=10,
        settings=settings,
    )

    assert result == {"snapshots": 1}
    with sqlite3.connect(tmp_path / "vibe_idx.sqlite") as conn:
        rows = conn.execute(
            "SELECT ticker, report_month FROM monthly_ownership_snapshots"
        ).fetchall()
    assert rows == [("BBCA", "2026-06")]
