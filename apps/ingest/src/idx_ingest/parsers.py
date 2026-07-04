from __future__ import annotations

import datetime as dt
import re
import xml.etree.ElementTree as ET
import zipfile
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from io import BytesIO
from typing import Any

from idx_ingest.models import (
    DailyPrice,
    InsiderReport,
    InsiderTransaction,
    KseiFivePctReport,
    KseiFivePctRow,
    KseiOnePctReport,
    KseiOnePctRow,
    MonthlyOwnershipSnapshot,
    SuspensionEvent,
    TransactionType,
)
from idx_ingest.util import (
    extract_page_texts,
    extract_text,
    parse_decimal,
    parse_filename_date,
    parse_idx_date,
    parse_int,
)

CLASSIFICATIONS = sorted(
    {
        "Commanditaire Vennootschap (CV) Or Limited Partnership",
        "Financial Institutional",
        "Investment Advisors",
        "Investment Manager",
        "Securities Company",
        "State Owned Enterprises",
        "Mutual Funds",
        "Private Equity",
        "Private Bank",
        "Corporate",
        "Individual",
        "Insurance",
        "Partnership",
        "Firm",
        "Bank",
    },
    key=len,
    reverse=True,
)
MONTH_NAMES = {
    "Januari": "01",
    "Februari": "02",
    "Maret": "03",
    "April": "04",
    "Mei": "05",
    "Juni": "06",
    "Juli": "07",
    "Agustus": "08",
    "September": "09",
    "Oktober": "10",
    "November": "11",
    "Desember": "12",
}

ONE_PCT_RE = re.compile(
    r"^(?P<date>\d{1,2}-[A-Za-z]{3}-\d{4})\s+"
    r"(?P<ticker>[A-Z0-9]{4})\s+(?P<body>.+?)\s+"
    r"(?P<scripless>[\d.]+)\s+(?P<scrip>[\d.]+)\s+"
    r"(?P<total>[\d.]+)\s+(?P<pct>\d+(?:,\d+)?)$"
)
FIVE_PCT_RE = re.compile(
    r"^(?:(?P<rank>\d+)\s+)?(?P<ticker>[A-Z0-9]{4})\s+(?P<body>.+?)\s+"
    r"(?P<prev_shares>[\d,.]+)\s+(?P<prev_sid>[\d,.]+)\s+"
    r"(?P<prev_pct>\d+(?:[,.]\d+)?)\s+(?P<curr_shares>[\d,.]+)\s+"
    r"(?P<curr_sid>[\d,.]+)\s+(?P<curr_pct>\d+(?:[,.]\d+)?)\s+"
    r"(?P<change>-?[\d,.]+)$"
)
INSIDER_TX_RE = re.compile(
    r"\b(Pembelian|Penjualan|Hibah|Lainnya)\s+(Ya|Tidak)\s+"
    r"(.{0,80}?)\s+([\d.]+,\d{2})\s+Saham\s+Biasa\s+"
    r"(-|[\d.]+,\d{2})\s+(\d{1,2}-[A-Za-z]{3})-\s*(\d{4})\s+(.+?)"
    r"(?=\s+(?:Pembelian|Penjualan|Hibah|Lainnya)\s+(?:Ya|Tidak)\s+"
    r"|\s+(?:Pemberi Kuasa|Keterangan Pengendali|Saya bertanggung jawab)|$)",
    re.I,
)


def parse_market_summary(payload: dict[str, Any], trade_date: dt.date) -> list[DailyPrice]:
    rows = payload.get("data") or payload.get("Data") or []
    prices: list[DailyPrice] = []
    for row in rows:
        ticker = (row.get("StockCode") or row.get("stockCode") or "").strip()
        if not ticker:
            continue
        prices.append(
            DailyPrice(
                trade_date=trade_date,
                ticker=ticker,
                name=(row.get("StockName") or "").strip() or None,
                previous=parse_decimal(row.get("Previous")),
                open=parse_decimal(row.get("OpenPrice")),
                high=parse_decimal(row.get("High")),
                low=parse_decimal(row.get("Low")),
                close=parse_decimal(row.get("Close")),
                volume=parse_int(row.get("Volume")),
                value=parse_decimal(row.get("Value")),
                frequency=parse_int(row.get("Frequency")),
                foreign_buy=parse_int(row.get("ForeignBuy")),
                foreign_sell=parse_int(row.get("ForeignSell")),
                listed_shares=parse_int(row.get("ListedShares")),
                tradeable_shares=parse_int(row.get("TradebleShares") or row.get("TradeableShares")),
            )
        )
    return prices


def parse_suspension_events(payload: dict[str, Any]) -> list[SuspensionEvent]:
    events: list[SuspensionEvent] = []
    for row in payload.get("Results") or []:
        ticker = (row.get("Kode") or "").strip().upper()
        event_type = (row.get("Info_Type") or "").strip().upper()
        event_at = _parse_iso_datetime(row.get("Date"))
        title = (row.get("Judul") or "").strip()
        if not _is_single_ticker(ticker) or event_type not in {"SPT", "UPT"} or event_at is None:
            continue
        events.append(
            SuspensionEvent(
                ticker=ticker,
                event_type=event_type,  # type: ignore[arg-type]
                event_at=event_at,
                title=title,
                attachment_url=(row.get("Data_Download") or "").strip() or None,
            )
        )
    return events


def parse_long_suspension_events(html: str) -> list[SuspensionEvent]:
    table = _SuspensionTableParser()
    table.feed(html)
    events: list[SuspensionEvent] = []
    for cells in table.rows:
        if len(cells) < 7:
            continue
        ticker = cells[1].strip().upper()
        issuer_name = cells[2].strip()
        suspension_date = _parse_idx_short_date(cells[6].strip())
        if not _is_single_ticker(ticker) or suspension_date is None:
            continue
        events.append(
            SuspensionEvent(
                ticker=ticker,
                event_type="SPT",
                event_at=dt.datetime.combine(suspension_date, dt.time.min),
                title=f"Suspensi > 6 Bulan: {issuer_name}",
                attachment_url=None,
            )
        )
    return events


class _SuspensionTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._current_row: list[str] | None = None
        self._current_cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._current_row = []
        elif tag == "td" and self._current_row is not None:
            self._current_cell = []
        elif tag == "br" and self._current_cell is not None:
            self._current_cell.append(" ")

    def handle_data(self, data: str) -> None:
        if self._current_cell is not None:
            self._current_cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self._current_row is not None and self._current_cell is not None:
            self._current_row.append(_normalize_space("".join(self._current_cell)))
            self._current_cell = None
        elif tag == "tr" and self._current_row is not None:
            self.rows.append(self._current_row)
            self._current_row = None


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def _is_single_ticker(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Z0-9]{2,8}", value))


def _parse_iso_datetime(value: object) -> dt.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    return dt.datetime.fromisoformat(value)


def _parse_idx_short_date(value: str) -> dt.date | None:
    match = re.fullmatch(r"(\d{1,2})-([A-Za-z]{3})-(\d{2})", value)
    if not match:
        return None
    day_text, month_text, year_text = match.groups()
    months = {
        "apr": 4,
        "agu": 8,
        "aug": 8,
        "des": 12,
        "dec": 12,
        "feb": 2,
        "jan": 1,
        "jul": 7,
        "jun": 6,
        "mar": 3,
        "mei": 5,
        "may": 5,
        "nov": 11,
        "okt": 10,
        "oct": 10,
        "sep": 9,
    }
    month = months.get(month_text.lower())
    if month is None:
        return None
    year = 2000 + int(year_text)
    return dt.date(year, month, int(day_text))


def parse_ksei_1pct_pdf(pdf_bytes: bytes) -> KseiOnePctReport:
    text, page_count = extract_text(pdf_bytes)
    return parse_ksei_1pct_text(text, page_count)


def parse_ksei_1pct_text(text: str, page_count: int = 0) -> KseiOnePctReport:
    rows = [row for line in _lines(text, dated=True) if (row := _parse_1pct_row(line))]
    if not rows:
        raise ValueError("No KSEI 1% rows found")
    return KseiOnePctReport(as_of_date=rows[0].as_of_date, page_count=page_count, rows=rows)


def parse_ksei_5pct_pdf(
    pdf_bytes: bytes,
    original_filename: str | None = None,
) -> KseiFivePctReport:
    text, page_count = extract_text(pdf_bytes)
    as_of_date = _ksei_as_of_date(text) or (
        parse_filename_date(original_filename or "") if original_filename else None
    )
    if as_of_date is None:
        raise ValueError("No KSEI 5% as_of_date found")
    periods = re.findall(r"Kepemilikan Per\s+([0-9]{1,2}-[A-Za-z]{3}-[0-9]{4})", text, re.I)
    rows = [row for line in _lines(text) if (row := _parse_5pct_row(line))]
    return KseiFivePctReport(
        previous_date=parse_idx_date(periods[-1]) if len(periods) >= 2 else None,
        as_of_date=as_of_date,
        source_date=parse_filename_date(original_filename or ""),
        page_count=page_count,
        rows=rows,
    )


def parse_ksei_5pct_xlsx(
    xlsx_bytes: bytes,
    as_of_date: dt.date,
    source_date: dt.date | None = None,
) -> KseiFivePctReport:
    sheet = _xlsx_first_sheet(xlsx_bytes)
    header_index = next(
        (
            index
            for index, row in enumerate(sheet)
            if _find_column(row, "kode") is not None
            and _find_column(row, "pemegang", "saham") is not None
        ),
        None,
    )
    if header_index is None:
        raise ValueError("No KSEI 5% XLSX header found")

    subheaders = sheet[header_index + 1] if header_index + 1 < len(sheet) else []
    has_subheaders = _find_column(subheaders, "jumlah", "saham") is not None
    headers = (
        _merge_header_rows(sheet[header_index], subheaders)
        if has_subheaders
        else sheet[header_index]
    )
    data_rows = sheet[header_index + 2 :] if has_subheaders else sheet[header_index + 1 :]
    share_cols = _find_columns(headers, "jumlah", "saham")
    sid_cols = _find_columns(headers, "saham", "gabungan")
    percent_cols = _find_columns(headers, "persentase") or _find_columns(headers, "persen")
    rows: list[KseiFivePctRow] = []
    for row in data_rows:
        ticker = _cell(row, _find_column(headers, "kode"))
        if not ticker or not re.fullmatch(r"[A-Z0-9]{4}", ticker):
            continue
        current_shares = parse_int(_cell(row, share_cols[-1] if share_cols else None))
        previous_shares = parse_int(_cell(row, share_cols[0] if len(share_cols) > 1 else None))
        rows.append(
            KseiFivePctRow(
                ticker=ticker,
                issuer_name=_cell(
                    row,
                    _find_column(headers, "nama", "perusahaan")
                    or _find_column(headers, "nama", "emiten"),
                ),
                shareholder_name=_cell(row, _find_column(headers, "pemegang", "saham")),
                account_holder_name=_cell(
                    row,
                    _find_column(headers, "pemegang", "rekening", "efek"),
                ),
                account_name=_cell(row, _find_column(headers, "nama rekening")),
                investor_status=_cell(row, _find_column(headers, "status")),
                previous_shares=previous_shares,
                previous_sid_total=parse_int(
                    _cell(row, sid_cols[0] if len(sid_cols) > 1 else None)
                ),
                previous_percent=parse_decimal(
                    _cell(row, percent_cols[0] if len(percent_cols) > 1 else None)
                ),
                current_shares=current_shares,
                current_sid_total=parse_int(_cell(row, sid_cols[-1] if sid_cols else None)),
                current_percent=parse_decimal(
                    _cell(row, percent_cols[-1] if percent_cols else None)
                ),
                reported_change=parse_int(_cell(row, _find_column(headers, "perubahan"))),
                actual_change=(current_shares - previous_shares)
                if current_shares is not None and previous_shares is not None
                else None,
            )
        )
    if not rows:
        raise ValueError("No KSEI 5% XLSX rows found")
    return KseiFivePctReport(
        as_of_date=as_of_date,
        source_date=source_date,
        page_count=1,
        rows=rows,
    )


def parse_insider_pdf(pdf_bytes: bytes) -> InsiderReport:
    page_texts, _ = extract_page_texts(pdf_bytes)
    id_text = _flat(page_texts[0] if page_texts else "")
    indonesian_pages = [_flat(page) for page in page_texts if not page.startswith("REPORT OF")]
    controller_text = next(
        (page for page in indonesian_pages if "Keterangan Pengendali" in page),
        "",
    )
    shares_before = _int_after(id_text, "Jumlah Saham Sebelum Transaksi")
    shares_after = _int_after(id_text, "Jumlah Saham Setelah Transaksi")
    ticker, issuer = _issuer(id_text)
    is_controller, will_maintain_control = _parse_controller_flags(controller_text)
    transactions = [
        tx
        for page in indonesian_pages[1:]
        for tx in _parse_transactions(page.split("Keterangan Pengendali", 1)[0])
    ]
    return InsiderReport(
        ticker=ticker,
        issuer_name=issuer,
        reporter_name=_value_after(id_text, "Nama (sesuai SID)", "Anggota Direksi"),
        sid_name=_value_after(id_text, "Nama (sesuai SID)", "Anggota Direksi"),
        position=_value_after(id_text, "Jabatan", "Alamat Identitas"),
        is_director_or_commissioner=_yes_no(
            _value_after(id_text, "Anggota Direksi/Dewan Komisaris", "Jabatan")
        ),
        shares_before=shares_before,
        voting_percent_before=_parse_percent(
            _value_after(id_text, "Hak Suara Sebelum Transaksi", "Jumlah Saham Setelah")
        ),
        shares_after=shares_after,
        voting_percent_after=_parse_percent(
            _value_after(id_text, "Hak Suara Setelah Transaksi", "Nomor")
            or _value_after(id_text, "Hak Suara Setelah Transaksi", "Jenis Transaksi")
        ),
        delta_total=(shares_after - shares_before)
        if shares_after is not None and shares_before is not None
        else None,
        is_controller=is_controller,
        will_maintain_control=will_maintain_control,
        transactions=transactions,
    )


def parse_laporan_efek_pdf(pdf_bytes: bytes) -> MonthlyOwnershipSnapshot:
    text, _ = extract_text(pdf_bytes)
    flat = " ".join(text.split())
    ticker, issuer = _issuer_header(flat)
    return MonthlyOwnershipSnapshot(
        ticker=ticker,
        issuer_name=issuer,
        report_month=_report_month(flat),
        registrar=_label(flat, "Biro Administrasi Efek", "Nama Alamat"),
        total_shares=_first_int_after(flat, "Jumlah saham tercatat di Bursa per akhir bulan"),
        treasury_shares=_first_int_after(flat, "Jumlah saham tresuri"),
        scrip_shares=_holder_bucket(flat, "Pemegang Saham < 5% - Warkat"),
        scripless_shares=_holder_bucket(flat, "Pemegang Saham < 5% - Non Warkat"),
        reported_free_float_percent=_free_float_percent(flat),
    )


def normalize_transaction_type(raw: str, purpose: str | None = None) -> TransactionType:
    lowered = f"{raw} {purpose or ''}".lower()
    if "buyback" in lowered:
        return "BUYBACK"
    if "pembelian" in lowered:
        return "BUY"
    if "penjualan" in lowered:
        return "SELL"
    if "hibah" in lowered:
        return "GRANT"
    if "transfer" in lowered:
        return "TRANSFER"
    return "OTHER"


def _lines(text: str, dated: bool = False) -> list[str]:
    lines = [" ".join(line.split()) for line in text.splitlines() if line.strip()]
    if not dated:
        return lines
    return [line for line in lines if re.match(r"^\d{1,2}-[A-Za-z]{3}-\d{4}\s+", line)]


def _parse_1pct_row(line: str) -> KseiOnePctRow | None:
    match = ONE_PCT_RE.match(line)
    as_of_date = parse_idx_date(match.group("date")) if match else None
    if not match or as_of_date is None:
        return None
    issuer_name, holder = _split_issuer(match.group("body"))
    investor_name, classification, local_foreign, nationality, domicile = _split_holder(holder)
    return KseiOnePctRow(
        as_of_date=as_of_date,
        ticker=match.group("ticker"),
        issuer_name=issuer_name,
        investor_name=investor_name,
        investor_classification=classification,
        local_foreign=local_foreign,
        nationality=nationality,
        domicile=domicile,
        holdings_scripless=parse_int(match.group("scripless")),
        holdings_scrip=parse_int(match.group("scrip")),
        total_holding_shares=parse_int(match.group("total")),
        percentage=parse_decimal(match.group("pct")),
    )


def _parse_5pct_row(line: str) -> KseiFivePctRow | None:
    match = FIVE_PCT_RE.match(line)
    if not match or match.group("rank") is None:
        return None
    previous_shares = parse_int(match.group("prev_shares"))
    current_shares = parse_int(match.group("curr_shares"))
    return KseiFivePctRow(
        ticker=match.group("ticker"),
        shareholder_name=match.group("body"),
        previous_shares=previous_shares,
        previous_sid_total=parse_int(match.group("prev_sid")),
        previous_percent=parse_decimal(match.group("prev_pct")),
        current_shares=current_shares,
        current_sid_total=parse_int(match.group("curr_sid")),
        current_percent=parse_decimal(match.group("curr_pct")),
        reported_change=parse_int(match.group("change")),
        actual_change=(current_shares - previous_shares)
        if current_shares is not None and previous_shares is not None
        else None,
    )


def _xlsx_first_sheet(xlsx_bytes: bytes) -> list[list[str]]:
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    with zipfile.ZipFile(BytesIO(xlsx_bytes)) as archive:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = [
                "".join(text.text or "" for text in item.iter(f"{ns}t"))
                for item in root.findall(f"{ns}si")
            ]
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))

    rows: list[list[str]] = []
    for row in sheet.iter(f"{ns}row"):
        values: list[str] = []
        for cell in row.findall(f"{ns}c"):
            column = _xlsx_column_index(cell.get("r", "A1"))
            while len(values) <= column:
                values.append("")
            values[column] = _xlsx_cell_value(cell, shared, ns)
        rows.append(values)
    return rows


def _xlsx_cell_value(cell: ET.Element, shared: list[str], ns: str) -> str:
    value = cell.find(f"{ns}v")
    text = "" if value is None else value.text or ""
    if cell.get("t") == "s" and text:
        return shared[int(text)]
    if cell.get("t") == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(f"{ns}t")).strip()
    return text.strip()


def _xlsx_column_index(cell_ref: str) -> int:
    letters = re.match(r"[A-Z]+", cell_ref)
    total = 0
    for char in letters.group(0) if letters else "A":
        total = total * 26 + ord(char) - ord("A") + 1
    return total - 1


def _cell(row: list[str], index: int | None) -> str | None:
    if index is None or index >= len(row):
        return None
    return _clean_value(row[index])


def _find_column(headers: list[str], *tokens: str) -> int | None:
    columns = _find_columns(headers, *tokens)
    return columns[0] if columns else None


def _find_columns(headers: list[str], *tokens: str) -> list[int]:
    normalized_tokens = [_normalize_header(token) for token in tokens]
    return [
        index
        for index, header in enumerate(headers)
        if all(token in _normalize_header(header) for token in normalized_tokens)
    ]


def _merge_header_rows(top: list[str], bottom: list[str]) -> list[str]:
    merged: list[str] = []
    group = ""
    for index in range(max(len(top), len(bottom))):
        group = _cell(top, index) or group
        merged.append(" ".join(part for part in (group, _cell(bottom, index)) if part))
    return merged


def _normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9%]+", "", value.lower())


def _split_issuer(body: str) -> tuple[str, str]:
    match = re.search(r"\bTbk\b\.?", body)
    if not match:
        parts = body.split(" ", 1)
        return parts[0], parts[1] if len(parts) > 1 else ""
    return body[: match.end()].strip(), body[match.end() :].strip()


def _split_holder(holder: str) -> tuple[str, str | None, str | None, str | None, str | None]:
    for classification in CLASSIFICATIONS:
        match = re.search(rf"\s{re.escape(classification)}\s([LF])(?:\s+(.*))?$", holder)
        if not match:
            continue
        tail = (match.group(2) or "").strip()
        nationality, domicile = _split_nationality_domicile(classification, tail)
        return (
            holder[: match.start()].strip(),
            classification,
            match.group(1),
            nationality,
            domicile,
        )
    return holder.strip(), None, None, None, None


def _flat(text: str) -> str:
    return " ".join(text.split())


def _clean_value(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return None if text.lower() in {"", "-", "null", "none"} else text


def _split_nationality_domicile(classification: str, tail: str) -> tuple[str | None, str | None]:
    if not tail:
        return None, None
    parts = tail.split()
    if classification == "Individual" and len(parts) >= 2:
        return parts[0], " ".join(parts[1:])
    return None, tail


def _ksei_as_of_date(text: str):
    match = re.search(
        r"per tanggal\s+([0-9]{1,2}\s*[- ]\s*[A-Za-z]{3}\s*[- ]\s*[0-9]{4})",
        text,
        re.I,
    )
    return parse_idx_date(match.group(1)) if match else None


def _value_after(text: str, label: str, stop: str) -> str | None:
    match = re.search(rf"{re.escape(label)}\s*:\s*(.*?)\s+{re.escape(stop)}", text, re.I)
    return _clean_value(match.group(1)) if match else None


def _int_after(text: str, label: str) -> int | None:
    match = re.search(rf"{re.escape(label)}\s*:\s*([\d.,]+)", text, re.I)
    return parse_int(match.group(1)) if match else None


def _yes_no(value: str | None) -> bool | None:
    if value is None:
        return None
    if "ya" in value.lower():
        return True
    if "tidak" in value.lower():
        return False
    return None


def _issuer(text: str) -> tuple[str | None, str | None]:
    value = _value_after(text, "Nama Perusahaan Tbk", "Jumlah Saham Sebelum Transaksi")
    if not value:
        return None, None
    if " - " in value:
        ticker, issuer = value.split(" - ", 1)
        return ticker.strip(), issuer.strip()
    return None, value.strip()


def _parse_transaction(text: str) -> InsiderTransaction | None:
    match = INSIDER_TX_RE.search(text)
    if not match:
        return None
    return _transaction_from_match(match)


def _parse_transactions(text: str) -> list[InsiderTransaction]:
    return [_transaction_from_match(match) for match in INSIDER_TX_RE.finditer(text)]


def _parse_controller_flags(text: str) -> tuple[bool | None, bool | None]:
    return (
        _yes_no(_value_after(text, "Keterangan Pengendali", "Jika ya")),
        _yes_no(
            _value_after(
                text,
                "Jika ya, apakah akan mempertahankan pengendalian?",
                "Nama pemegang saham",
            )
        ),
    )


def _transaction_from_match(match: re.Match[str]) -> InsiderTransaction:
    raw = match.group(1)
    ownership_status, direct_owner, unexercised, exercise_deadline = _split_transaction_tail(
        match.group(3)
    )
    purpose = match.group(8).strip()
    return InsiderTransaction(
        transaction_type_raw=raw,
        transaction_type=normalize_transaction_type(raw, purpose),
        is_repo=_yes_no(match.group(2)),
        ownership_status=ownership_status,
        direct_owner_name=direct_owner,
        unexercised_amount=parse_int(unexercised),
        exercise_deadline=parse_idx_date(exercise_deadline or ""),
        shares=parse_int(match.group(4)),
        share_classification="Saham Biasa",
        price=parse_decimal(match.group(5)),
        transaction_date=parse_idx_date(f"{match.group(6)}-{match.group(7)}"),
        purpose=purpose,
    )


def _split_transaction_tail(tail: str) -> tuple[str | None, str | None, str | None, str | None]:
    parts = tail.split()
    if len(parts) < 3:
        return _clean_value(tail), None, None, None
    if len(parts) >= 4 and re.fullmatch(r"\d{1,2}-[A-Za-z]{3}-", parts[-2]):
        unexercised, exercise_deadline = parts[-3], f"{parts[-2]}{parts[-1]}"
        owner_parts = parts[:-3]
    else:
        unexercised, exercise_deadline = parts[-2], parts[-1]
        owner_parts = parts[:-2]
    if owner_parts[:2] == ["Tidak", "Langsung"]:
        return (
            "Tidak Langsung",
            _clean_value(" ".join(owner_parts[2:])),
            unexercised,
            exercise_deadline,
        )
    if owner_parts[:1] == ["Langsung"]:
        return "Langsung", _clean_value(" ".join(owner_parts[1:])), unexercised, exercise_deadline
    return _clean_value(" ".join(owner_parts)), None, unexercised, exercise_deadline


def _issuer_header(text: str) -> tuple[str | None, str | None]:
    match = re.search(
        r"Perihal\s+\S+\s+(?P<issuer>.+?)\s+(?P<ticker>[A-Z]{4})\s+\d+\s+"
        r"Laporan Bulanan Registrasi Pemegang Efek",
        text,
        re.I,
    )
    if not match:
        return None, None
    return match.group("ticker"), match.group("issuer").strip()


def _label(text: str, start: str, stop: str) -> str | None:
    match = re.search(rf"{re.escape(start)}:?\s+(.*?)\s+{re.escape(stop)}", text, re.I)
    return match.group(1).strip() if match else None


def _report_month(text: str) -> str | None:
    match = re.search(r"akhir bulan\s+([A-Za-z]+)\s*-\s*(\d{4})", text, re.I)
    month = MONTH_NAMES.get(match.group(1).capitalize()) if match else None
    return f"{match.group(2)}-{month}" if match and month else None


def _first_int_after(text: str, label: str) -> int | None:
    match = re.search(rf"{re.escape(label)}.*?([\d.]+)", text, re.I)
    return parse_int(match.group(1)) if match else None


def _first_decimal_after(text: str, label: str):
    match = re.search(rf"{re.escape(label)}.*?(\d+(?:,\d+)?|\d+(?:\.\d+)?)", text, re.I)
    return parse_decimal(match.group(1)) if match else None


def _free_float_percent(text: str) -> Decimal | None:
    match = re.search(
        r"% Saham Free Float\s+(.*?)(?:Jumlah saham yang harus dibatasi|Pernyataan|$)",
        text,
        re.I,
    )
    if not match:
        return None

    values = [
        value
        for raw in re.findall(
            r"(?<![\d.,])(\d{1,3}(?:,\d{1,4}|\.\d{1,4}))(?![\d.,])",
            match.group(1),
        )
        if (value := parse_decimal(raw)) is not None and value <= 100
    ]
    return values[-1] if values else None


def _parse_percent(value: str | None) -> Decimal | None:
    text = (value or "").strip().replace("%", "").replace(".", "").replace(",", ".")
    if not text or text in {"-", "None"}:
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def _holder_bucket(text: str, label: str) -> int | None:
    match = re.search(rf"{re.escape(label)}.*?([\d.]+)\s+\d+(?:,\d+)?%", text, re.I)
    return parse_int(match.group(1)) if match else None
