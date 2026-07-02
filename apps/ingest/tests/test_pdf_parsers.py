from __future__ import annotations

import datetime as dt
import zipfile
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from idx_ingest.parsers import (
    _parse_controller_flags,
    _parse_percent,
    _parse_transactions,
    parse_insider_pdf,
    parse_ksei_5pct_pdf,
    parse_ksei_5pct_xlsx,
    parse_laporan_efek_pdf,
)
from idx_ingest.util import extract_text_pdfplumber

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_parse_existing_ksei_5pct_fixture_dates() -> None:
    path = (
        REPO_ROOT
        / "samples/idx-5pct/20260608_Semua Emiten Saham_Pengumuman Bursa_32098373_lamp1.pdf"
    )
    report = parse_ksei_5pct_pdf(path.read_bytes(), path.name)
    assert report.as_of_date == dt.date(2026, 6, 5)
    assert report.previous_date == dt.date(2026, 6, 4)
    assert report.page_count == 20
    assert report.rows


def test_parse_ksei_5pct_xlsx() -> None:
    report = parse_ksei_5pct_xlsx(
        _xlsx(
            [
                ["Kode", "Nama Perusahaan", "Pemegang Saham", "Jumlah Saham", "Persen"],
                [
                    "CYBR",
                    "PT ITSEC Asia Tbk.",
                    "PT Maybank Sekuritas Indonesia",
                    "1.234.567",
                    "5,67",
                ],
            ]
        ),
        dt.date(2026, 6, 25),
    )
    assert report.as_of_date == dt.date(2026, 6, 25)
    assert report.rows[0].ticker == "CYBR"
    assert report.rows[0].issuer_name == "PT ITSEC Asia Tbk."
    assert report.rows[0].current_shares == 1234567
    assert report.rows[0].current_percent == Decimal("5.67")


def test_parse_existing_insider_fixture() -> None:
    path = REPO_ROOT / "samples/idx-insider/LK-08062026-4607-00.pdf"
    report = parse_insider_pdf(path.read_bytes())
    assert report.ticker == "BJTM"
    assert report.reporter_name == "R ARIEF WICAKSONO"
    assert report.shares_before == 2718600
    assert report.shares_after == 3718600
    assert report.delta_total == 1000000
    assert report.is_controller is False
    assert report.will_maintain_control is False


def test_parse_existing_laporan_efek_fixture() -> None:
    path = REPO_ROOT / (
        "samples/laporan-efek-samples-specific/"
        "BBCA_1_20260608_BBCA_Laporan Bulanan Registrasi Pemegang Efek_"
        "Perubahan Struktur Pemegang Saham_32098358.pdf"
    )
    snapshot = parse_laporan_efek_pdf(path.read_bytes())
    assert snapshot.ticker == "BBCA"
    assert snapshot.issuer_name == "PT Bank Central Asia Tbk."
    assert snapshot.report_month == "2026-05"
    assert snapshot.registrar == "PT. Raya Saham Registra"
    assert snapshot.reported_free_float_percent == Decimal("42.46")


def test_pdfplumber_extracts_insider_fixture() -> None:
    path = REPO_ROOT / "samples/idx-insider/LK-08062026-4607-00.pdf"
    text, page_count = extract_text_pdfplumber(path.read_bytes())
    assert page_count == 6
    assert "R ARIEF WICAKSONO" in text


def test_parse_insider_transaction_with_blank_price() -> None:
    transactions = _parse_transactions(
        "Jenis Transaksi Hibah Tidak Langsung - - - 174.386.780,00 "
        "Saham Biasa - 12-Jun- 2026 Hibah Pemberi Kuasa"
    )
    assert transactions[0].transaction_type == "GRANT"
    assert transactions[0].price is None
    assert transactions[0].shares == 174386780
    assert transactions[0].ownership_status == "Langsung"


def test_parse_multiple_insider_transactions() -> None:
    transactions = _parse_transactions(
        "Pembelian Tidak Langsung - - - 603.100,00 Saham Biasa 540,00 "
        "08-Jun- 2026 Investasi Pembelian Tidak Langsung - - - 521.000,00 "
        "Saham Biasa 535,00 08-Jun- 2026 Investasi Pemberi Kuasa"
    )
    assert [tx.shares for tx in transactions] == [603100, 521000]
    assert transactions[0].ownership_status == "Langsung"
    assert transactions[0].direct_owner_name is None


def test_short_transaction_table_can_share_page_with_controller_block() -> None:
    page = (
        "Pembelian Tidak Langsung - - - 1.000.000,00 Saham Biasa 10.000,00 "
        "12-Jun- 2026 Investasi Keterangan Pengendali : Ya "
        "Jika ya, apakah akan mempertahankan pengendalian? : Tidak "
        "Nama pemegang saham"
    )
    transactions = _parse_transactions(page.split("Keterangan Pengendali", 1)[0])
    assert len(transactions) == 1
    assert transactions[0].shares == 1000000
    assert _parse_controller_flags(page) == (True, False)


def test_parse_three_decimal_percent() -> None:
    assert _parse_percent("0,251%") == Decimal("0.251")


def _xlsx(rows: list[list[str]]) -> bytes:
    sheet_rows = []
    for row_index, row in enumerate(rows, 1):
        cells = []
        for col_index, value in enumerate(row):
            col = chr(ord("A") + col_index)
            cells.append(
                f'<c r="{col}{row_index}" t="inlineStr"><is><t>{value}</t></is></c>'
            )
        sheet_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    sheet = (
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
    )
    out = BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("xl/worksheets/sheet1.xml", sheet)
    return out.getvalue()
