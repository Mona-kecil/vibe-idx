from __future__ import annotations

import datetime as dt
import hashlib
import re
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import Path

import pdfplumber
from pypdf import PdfReader

from idx_ingest.models import RawFileRef

MONTHS = {
    "JAN": 1,
    "FEB": 2,
    "MAR": 3,
    "APR": 4,
    "MEI": 5,
    "MAY": 5,
    "JUN": 6,
    "JUL": 7,
    "AGU": 8,
    "AUG": 8,
    "SEP": 9,
    "OKT": 10,
    "OCT": 10,
    "NOV": 11,
    "DES": 12,
    "DEC": 12,
}


def yyyymmdd(value: dt.date) -> str:
    return value.strftime("%Y%m%d")


def parse_cli_date(value: str) -> dt.date:
    if re.fullmatch(r"\d{8}", value):
        return dt.datetime.strptime(value, "%Y%m%d").date()
    return dt.date.fromisoformat(value)


def parse_idx_date(value: str) -> dt.date | None:
    text = " ".join(value.strip().replace(" -", "-").replace("- ", "-").split())
    match = re.search(r"(\d{1,2})\s*[- ]\s*([A-Za-z]{3})\s*[- ]\s*(\d{4})", text)
    if not match:
        return None
    month = MONTHS.get(match.group(2).upper())
    return dt.date(int(match.group(3)), month, int(match.group(1))) if month else None


def parse_filename_date(filename: str) -> dt.date | None:
    match = re.match(r"(\d{4})(\d{2})(\d{2})_", filename)
    if not match:
        return None
    try:
        return dt.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def parse_decimal(value: object) -> Decimal | None:
    text = str(value).strip().replace("%", "").replace("\xa0", " ").replace(" ", "")
    if not text or text in {"-", "None"}:
        return None
    if "." in text and "," in text:
        text = (
            text.replace(".", "").replace(",", ".")
            if text.rfind(",") > text.rfind(".")
            else text.replace(",", "")
        )
    elif "." in text and all(len(part) == 3 for part in text.split(".")[1:]):
        text = text.replace(".", "")
    elif "," in text:
        parts = text.split(",")
        text = (
            "".join(parts)
            if len(parts) > 1 and all(len(p) == 3 for p in parts[1:])
            else text.replace(".", "").replace(",", ".")
        )
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def parse_int(value: object) -> int | None:
    number = parse_decimal(value)
    return int(number) if number is not None else None


def extract_text(pdf_bytes: bytes, max_pages: int | None = None) -> tuple[str, int]:
    texts, page_count = extract_page_texts(pdf_bytes, max_pages)
    return "\n".join(texts), page_count


def extract_page_texts(pdf_bytes: bytes, max_pages: int | None = None) -> tuple[list[str], int]:
    reader = PdfReader(BytesIO(pdf_bytes))
    pages = reader.pages[:max_pages] if max_pages else reader.pages
    texts = [page.extract_text() or "" for page in pages]
    if any(text.strip() for text in texts):
        return texts, len(reader.pages)

    try:
        text, page_count = extract_text_pdfplumber(pdf_bytes, max_pages)
        return text.split("\f"), page_count
    except Exception:
        return texts, len(reader.pages)


def extract_text_pdfplumber(pdf_bytes: bytes, max_pages: int | None = None) -> tuple[str, int]:
    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        pages = pdf.pages[:max_pages] if max_pages else pdf.pages
        text = "\f".join(page.extract_text() or "" for page in pages)
        return text, len(pdf.pages)


def store_raw_bytes(
    raw_dir: Path,
    kind: str,
    data: bytes,
    *,
    source_url: str | None = None,
    original_filename: str | None = None,
    content_type: str | None = None,
) -> RawFileRef:
    digest = hashlib.sha256(data).hexdigest()
    target_dir = raw_dir / kind / digest[:2]
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{digest}{Path(original_filename or '').suffix}"
    if not target.exists():
        target.write_bytes(data)
    return RawFileRef(
        sha256=digest,
        kind=kind,
        source_url=source_url,
        original_filename=original_filename,
        content_type=content_type,
        size_bytes=len(data),
        local_path=str(target),
        fetched_at=dt.datetime.now(dt.UTC),
    )
