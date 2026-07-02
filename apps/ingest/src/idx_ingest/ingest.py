from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from curl_cffi import requests
from tenacity import retry, stop_after_attempt, wait_exponential

from idx_ingest.db import (
    connect,
    link_announcement_file,
    record_parser_run,
    upsert_announcement,
    upsert_daily_prices,
    upsert_insider_report,
    upsert_ksei_1pct_report,
    upsert_ksei_5pct_report,
    upsert_monthly_snapshot,
    upsert_raw_file,
)
from idx_ingest.models import Announcement
from idx_ingest.parsers import (
    parse_insider_pdf,
    parse_ksei_1pct_pdf,
    parse_ksei_5pct_xlsx,
    parse_laporan_efek_pdf,
    parse_market_summary,
)
from idx_ingest.sources import source_policy
from idx_ingest.util import store_raw_bytes, yyyymmdd

IDX_BASE = "https://www.idx.co.id"
REPO_ROOT = Path(__file__).resolve().parents[4]
HEADERS = {
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://www.idx.co.id/id/perusahaan-tercatat/keterbukaan-informasi/",
    "Origin": IDX_BASE,
}
INSIDER_TITLE = "LAPORAN KEPEMILIKAN ATAU SETIAP PERUBAHAN KEPEMILIKAN SAHAM PERUSAHAAN TERBUKA"
INSIDER_TITLE_PHRASE = "laporan kepemilikan atau setiap perubahan kepemilikan saham"
KSEI_1PCT_TITLE = "Pemegang Saham di atas 1% (KSEI)"


@dataclass(frozen=True)
class Settings:
    database_url: str = os.environ.get(
        "VIBE_IDX_DATABASE_URL",
        f"sqlite:///{REPO_ROOT / 'data' / 'vibe_idx.sqlite'}",
    )
    raw_dir: Path = Path(os.environ.get("VIBE_IDX_RAW_DIR", REPO_ROOT / "data" / "raw"))


def _default_lookback_days(source_name: str) -> int:
    lookback_days = source_policy(source_name).default_lookback_days
    if lookback_days is None:
        raise ValueError(f"source {source_name} does not define a default lookback")
    return lookback_days


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
def fetch_bytes(url: str, accept: str = "application/json, text/plain, */*") -> bytes:
    last_error: Exception | None = None
    for profile in ("chrome136", "chrome124", "chrome120", "chrome"):
        try:
            response = requests.get(
                url,
                headers={**HEADERS, "Accept": accept},
                impersonate=profile,
                timeout=30,
            )
            response.raise_for_status()
            return response.content
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"IDX fetch failed: {last_error}")


def fetch_json(url: str) -> dict[str, Any]:
    return json.loads(fetch_bytes(url).decode("utf-8-sig"))


def announcement_url(keyword: str, date_from: dt.date, date_to: dt.date, page_size: int) -> str:
    params = {
        "kodeEmiten": "",
        "emitenType": "*",
        "indexFrom": 0,
        "pageSize": page_size,
        "dateFrom": yyyymmdd(date_from),
        "dateTo": yyyymmdd(date_to),
        "lang": "id",
        "keyword": keyword,
    }
    return f"{IDX_BASE}/primary/ListedCompany/GetAnnouncement?{urlencode(params)}"


def market_summary_url(trade_date: dt.date) -> str:
    params = {"date": yyyymmdd(trade_date), "length": 9999, "start": 0}
    return f"{IDX_BASE}/primary/TradingSummary/GetStockSummary?{urlencode(params)}"


def ownership_list_url(year: int) -> str:
    return (
        f"{IDX_BASE}/primary/list/id/perusahaan-tercatat/data-kepemilikan-saham/"
        f"?{urlencode({'year': year, 'lang': 'id'})}"
    )


def announcement_title(item: dict[str, Any]) -> str:
    return (item.get("pengumuman") or {}).get("JudulPengumuman") or ""


def announcement_matches_title(item: dict[str, Any], title: str) -> bool:
    return title.lower() in announcement_title(item).lower()


def is_insider_announcement(item: dict[str, Any]) -> bool:
    return INSIDER_TITLE_PHRASE in announcement_title(item).lower()


def _announcement_date(item: dict[str, Any]) -> dt.date | None:
    published_at = (item.get("pengumuman") or {}).get("TglPengumuman")
    if not published_at:
        return None
    return dt.datetime.fromisoformat(published_at).date()


def choose_lamp1(item: dict[str, Any]) -> dict[str, Any] | None:
    attachments = item.get("attachments") or []
    for attachment in attachments:
        filename = attachment.get("OriginalFilename") or ""
        if attachment.get("IsAttachment") and "_lamp1" in filename:
            return attachment
    for attachment in attachments:
        if attachment.get("IsAttachment"):
            return attachment
    return attachments[0] if attachments else None


def is_insider_attachment(attachment: dict[str, Any]) -> bool:
    filename = attachment.get("OriginalFilename") or ""
    path = attachment.get("FullSavePath") or ""
    if filename.startswith("LK-") and "/From_KSEI/" in path:
        return True
    return bool(attachment.get("IsAttachment") and "_lamp" in filename.lower())


def ingest_market_summary(
    trade_date: dt.date,
    settings: Settings | None = None,
) -> dict[str, int | str]:
    settings = settings or Settings()
    url = market_summary_url(trade_date)
    payload = fetch_json(url)
    rows = parse_market_summary(payload, trade_date)
    if payload.get("data") and len(rows) <= 800:
        raise ValueError(f"market summary sanity check failed: only {len(rows)} parsed rows")
    return _persist_market_summary(settings, trade_date, url, payload, rows)


def ingest_latest_market_summary(
    today: dt.date | None = None,
    lookback_days: int | None = None,
    settings: Settings | None = None,
) -> dict[str, int | str]:
    today = today or dt.date.today()
    lookback_days = lookback_days if lookback_days is not None else _default_lookback_days(
        "market-summary"
    )
    settings = settings or Settings()
    for offset in range(lookback_days + 1):
        trade_date = today - dt.timedelta(days=offset)
        url = market_summary_url(trade_date)
        payload = fetch_json(url)
        rows = parse_market_summary(payload, trade_date)
        if not rows:
            continue
        if payload.get("data") and len(rows) <= 800:
            raise ValueError(f"market summary sanity check failed: only {len(rows)} parsed rows")
        return _persist_market_summary(settings, trade_date, url, payload, rows)
    return {"trade_date": today.isoformat(), "rows": 0}


def _persist_market_summary(
    settings: Settings,
    trade_date: dt.date,
    url: str,
    payload: dict[str, Any],
    rows,
) -> dict[str, int | str]:
    raw_file = _store_json(
        settings,
        "market-summary",
        payload,
        url,
        f"market-summary-{trade_date}.json",
    )

    with connect(settings.database_url) as conn:
        raw_file_id = upsert_raw_file(conn, raw_file)
        count = upsert_daily_prices(conn, rows, raw_file_id)
        record_parser_run(conn, raw_file_id, "market-summary", "parsed")
        conn.commit()
    return {"trade_date": trade_date.isoformat(), "rows": count}


def ingest_ksei_5pct(
    date_from: dt.date,
    date_to: dt.date,
    settings: Settings | None = None,
) -> dict[str, int]:
    settings = settings or Settings()
    payloads = [
        _store_ownership_list(settings, year)
        for year in range(date_from.year, date_to.year + 1)
    ]
    reports_seen = rows_seen = 0
    with connect(settings.database_url) as conn:
        for payload, response_id in payloads:
            record_parser_run(conn, response_id, "ksei-5pct-ownership-list", "parsed")
            for item in payload.get("items") or []:
                listing_date = dt.datetime.fromisoformat(item["ListingDate"]).date()
                if not date_from <= listing_date <= date_to or not item.get("Prospectus"):
                    continue
                announcement_id = upsert_announcement(
                    conn,
                    Announcement(**_ownership_announcement_model(item)),
                )
                raw_xlsx_id, xlsx = _download_file(
                    conn,
                    settings,
                    "ksei-5pct",
                    announcement_id,
                    item["Prospectus"],
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
                try:
                    report = parse_ksei_5pct_xlsx(xlsx, listing_date, listing_date)
                    upsert_ksei_5pct_report(conn, report, announcement_id, raw_xlsx_id)
                    record_parser_run(conn, raw_xlsx_id, "ksei-5pct", "parsed")
                    rows_seen += len(report.rows)
                    reports_seen += 1
                except Exception as exc:
                    record_parser_run(conn, raw_xlsx_id, "ksei-5pct", "failed", str(exc))
                    raise
        conn.commit()
    return {"reports": reports_seen, "rows": rows_seen}


def ingest_latest_ksei_5pct(
    today: dt.date | None = None,
    settings: Settings | None = None,
) -> dict[str, int]:
    today = today or dt.date.today()
    settings = settings or Settings()
    payload, response_id = _store_ownership_list(settings, today.year)
    latest = next((item for item in payload.get("items") or [] if item.get("Prospectus")), None)
    if latest is None:
        with connect(settings.database_url) as conn:
            record_parser_run(conn, response_id, "ksei-5pct-ownership-list", "parsed")
            conn.commit()
        return {"reports": 0, "rows": 0}

    listing_date = dt.datetime.fromisoformat(latest["ListingDate"]).date()
    rows_seen = 0
    with connect(settings.database_url) as conn:
        record_parser_run(conn, response_id, "ksei-5pct-ownership-list", "parsed")
        announcement_id = upsert_announcement(
            conn,
            Announcement(**_ownership_announcement_model(latest)),
        )
        raw_xlsx_id, xlsx = _download_file(
            conn,
            settings,
            "ksei-5pct",
            announcement_id,
            latest["Prospectus"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        try:
            report = parse_ksei_5pct_xlsx(xlsx, listing_date, listing_date)
            upsert_ksei_5pct_report(conn, report, announcement_id, raw_xlsx_id)
            record_parser_run(conn, raw_xlsx_id, "ksei-5pct", "parsed")
            rows_seen = len(report.rows)
        except Exception as exc:
            record_parser_run(conn, raw_xlsx_id, "ksei-5pct", "failed", str(exc))
            raise
        conn.commit()
    return {"reports": 1, "rows": rows_seen}


def ingest_ksei_1pct(
    date_from: dt.date,
    date_to: dt.date,
    page_size: int = 50,
    settings: Settings | None = None,
) -> dict[str, int]:
    keyword = "1%"
    kind = "ksei-1pct"
    settings = settings or Settings()
    payload, response_id = _store_announcement_search(
        settings,
        keyword,
        kind,
        date_from,
        date_to,
        page_size,
    )
    reports_seen = rows_seen = 0
    with connect(settings.database_url) as conn:
        record_parser_run(conn, response_id, f"{kind}-announcement-search", "parsed")
        for item in payload.get("Replies") or []:
            if not announcement_matches_title(item, KSEI_1PCT_TITLE):
                continue
            attachment = choose_lamp1(item)
            if not attachment:
                continue
            announcement_id = upsert_announcement(
                conn,
                Announcement(**_announcement_model(item, keyword)),
            )
            raw_pdf_id, pdf = _download_attachment(
                conn,
                settings,
                kind,
                announcement_id,
                attachment,
            )
            try:
                report = parse_ksei_1pct_pdf(pdf)
                upsert_ksei_1pct_report(conn, report, announcement_id, raw_pdf_id)
                record_parser_run(conn, raw_pdf_id, kind, "parsed")
                rows_seen += len(report.rows)
                reports_seen += 1
            except Exception as exc:
                record_parser_run(conn, raw_pdf_id, kind, "failed", str(exc))
                raise
        conn.commit()
    return {"reports": reports_seen, "rows": rows_seen}


def ingest_latest_ksei_1pct(
    today: dt.date | None = None,
    lookback_days: int | None = None,
    page_size: int = 50,
    settings: Settings | None = None,
) -> dict[str, int]:
    today = today or dt.date.today()
    lookback_days = lookback_days if lookback_days is not None else _default_lookback_days(
        "ksei-1pct"
    )
    settings = settings or Settings()
    date_from = today - dt.timedelta(days=lookback_days)
    payload, response_id = _store_announcement_search(
        settings,
        "1%",
        "ksei-1pct",
        date_from,
        today,
        page_size,
    )

    with connect(settings.database_url) as conn:
        record_parser_run(conn, response_id, "ksei-1pct-announcement-search", "parsed")
        item = next(
            (
                item
                for item in payload.get("Replies") or []
                if announcement_matches_title(item, KSEI_1PCT_TITLE)
            ),
            None,
        )
        if item is None:
            conn.commit()
            return {"reports": 0, "rows": 0}
        attachment = choose_lamp1(item)
        if attachment is None:
            conn.commit()
            return {"reports": 0, "rows": 0}

        announcement_id = upsert_announcement(
            conn,
            Announcement(**_announcement_model(item, "1%")),
        )
        raw_pdf_id, pdf = _download_attachment(
            conn,
            settings,
            "ksei-1pct",
            announcement_id,
            attachment,
        )
        try:
            report = parse_ksei_1pct_pdf(pdf)
            upsert_ksei_1pct_report(conn, report, announcement_id, raw_pdf_id)
            record_parser_run(conn, raw_pdf_id, "ksei-1pct", "parsed")
        except Exception as exc:
            record_parser_run(conn, raw_pdf_id, "ksei-1pct", "failed", str(exc))
            raise
        conn.commit()
    return {"reports": 1, "rows": len(report.rows)}


def ingest_insider(
    date_from: dt.date,
    date_to: dt.date,
    page_size: int = 50,
    settings: Settings | None = None,
) -> dict[str, int]:
    return _ingest_announcement_pdfs(
        keyword="laporan kepemilikan",
        kind="insider",
        date_from=date_from,
        date_to=date_to,
        page_size=page_size,
        parser=parse_insider_pdf,
        saver=upsert_insider_report,
        settings=settings or Settings(),
    )


def ingest_latest_insider(
    today: dt.date | None = None,
    lookback_days: int | None = None,
    page_size: int = 50,
    settings: Settings | None = None,
) -> dict[str, int]:
    today = today or dt.date.today()
    lookback_days = lookback_days if lookback_days is not None else _default_lookback_days(
        "insider"
    )
    settings = settings or Settings()
    date_from = today - dt.timedelta(days=lookback_days)
    payload, response_id = _store_announcement_search(
        settings,
        "laporan kepemilikan",
        "insider",
        date_from,
        today,
        page_size,
    )
    matching = [
        item
        for item in payload.get("Replies") or []
        if is_insider_announcement(item)
    ]
    dated_items = [
        (published_date, item)
        for item in matching
        if (published_date := _announcement_date(item))
    ]
    latest_date = max((published_date for published_date, _item in dated_items), default=None)
    latest_items = [item for published_date, item in dated_items if published_date == latest_date]

    parsed = 0
    with connect(settings.database_url) as conn:
        record_parser_run(conn, response_id, "insider-announcement-search", "parsed")
        for item in latest_items:
            announcement_id = upsert_announcement(
                conn,
                Announcement(**_announcement_model(item, "laporan kepemilikan")),
            )
            attachments = [
                a
                for a in item.get("attachments") or []
                if (a.get("FullSavePath") or "").lower().endswith(".pdf")
                and is_insider_attachment(a)
            ]
            for attachment in attachments:
                raw_pdf_id, pdf = _download_attachment(
                    conn,
                    settings,
                    "insider",
                    announcement_id,
                    attachment,
                )
                try:
                    upsert_insider_report(
                        conn,
                        parse_insider_pdf(pdf),
                        announcement_id,
                        raw_pdf_id,
                    )
                    record_parser_run(conn, raw_pdf_id, "insider", "parsed")
                    parsed += 1
                except Exception as exc:
                    record_parser_run(conn, raw_pdf_id, "insider", "failed", str(exc))
                    raise
        conn.commit()
    return {"reports": parsed}


def ingest_laporan_efek(
    date_from: dt.date,
    date_to: dt.date,
    page_size: int = 50,
    settings: Settings | None = None,
) -> dict[str, int]:
    return _ingest_announcement_pdfs(
        keyword="laporan efek",
        kind="laporan-efek",
        date_from=date_from,
        date_to=date_to,
        page_size=page_size,
        parser=parse_laporan_efek_pdf,
        saver=upsert_monthly_snapshot,
        settings=settings or Settings(),
        first_attachment_only=True,
        result_key="snapshots",
    )


def ingest_latest_laporan_efek(
    today: dt.date | None = None,
    lookback_days: int | None = None,
    page_size: int = 50,
    settings: Settings | None = None,
) -> dict[str, int]:
    today = today or dt.date.today()
    lookback_days = lookback_days if lookback_days is not None else _default_lookback_days(
        "laporan-efek"
    )
    settings = settings or Settings()
    date_from = today - dt.timedelta(days=lookback_days)
    payload, response_id = _store_announcement_search(
        settings,
        "laporan efek",
        "laporan-efek",
        date_from,
        today,
        page_size,
    )
    item = next(iter(payload.get("Replies") or []), None)
    parsed = 0
    with connect(settings.database_url) as conn:
        record_parser_run(conn, response_id, "laporan-efek-announcement-search", "parsed")
        if item is None:
            conn.commit()
            return {"snapshots": 0}
        announcement_id = upsert_announcement(
            conn,
            Announcement(**_announcement_model(item, "laporan efek")),
        )
        attachments = [
            a
            for a in item.get("attachments") or []
            if (a.get("FullSavePath") or "").lower().endswith(".pdf")
        ]
        for index, attachment in enumerate(attachments):
            raw_pdf_id, pdf = _download_attachment(
                conn,
                settings,
                "laporan-efek",
                announcement_id,
                attachment,
            )
            if index != 0:
                record_parser_run(conn, raw_pdf_id, "laporan-efek", "stored_unparsed")
                continue
            try:
                upsert_monthly_snapshot(
                    conn,
                    parse_laporan_efek_pdf(pdf),
                    announcement_id,
                    raw_pdf_id,
                )
                record_parser_run(conn, raw_pdf_id, "laporan-efek", "parsed")
                parsed += 1
            except Exception as exc:
                record_parser_run(conn, raw_pdf_id, "laporan-efek", "failed", str(exc))
                raise
        conn.commit()
    return {"snapshots": parsed}


def _ingest_announcement_pdfs(
    *,
    keyword: str,
    kind: str,
    date_from: dt.date,
    date_to: dt.date,
    page_size: int,
    parser,
    saver,
    settings: Settings,
    title: str | None = None,
    first_attachment_only: bool = False,
    result_key: str = "reports",
) -> dict[str, int]:
    payload, response_id = _store_announcement_search(
        settings,
        keyword,
        kind,
        date_from,
        date_to,
        page_size,
    )
    parsed = 0
    with connect(settings.database_url) as conn:
        record_parser_run(conn, response_id, f"{kind}-announcement-search", "parsed")
        for item in payload.get("Replies") or []:
            if kind == "insider" and not is_insider_announcement(item):
                continue
            if title and not announcement_matches_title(item, title):
                continue
            announcement_id = upsert_announcement(
                conn,
                Announcement(**_announcement_model(item, keyword)),
            )
            attachments = [
                a
                for a in item.get("attachments") or []
                if (a.get("FullSavePath") or "").lower().endswith(".pdf")
            ]
            if kind == "insider":
                attachments = [a for a in attachments if is_insider_attachment(a)]
            for index, attachment in enumerate(attachments):
                raw_pdf_id, pdf = _download_attachment(
                    conn,
                    settings,
                    kind,
                    announcement_id,
                    attachment,
                )
                if first_attachment_only and index != 0:
                    record_parser_run(conn, raw_pdf_id, kind, "stored_unparsed")
                    continue
                try:
                    saver(conn, parser(pdf), announcement_id, raw_pdf_id)
                    record_parser_run(conn, raw_pdf_id, kind, "parsed")
                    parsed += 1
                except Exception as exc:
                    record_parser_run(conn, raw_pdf_id, kind, "failed", str(exc))
                    raise
        conn.commit()
    return {result_key: parsed}


def _store_announcement_search(
    settings: Settings,
    keyword: str,
    kind: str,
    date_from: dt.date,
    date_to: dt.date,
    page_size: int,
) -> tuple[dict[str, Any], str]:
    url = announcement_url(keyword, date_from, date_to, page_size)
    payload = fetch_json(url)
    raw = _store_json(
        settings,
        f"{kind}-announcements",
        payload,
        url,
        f"{kind}-{date_from}-{date_to}.json",
    )
    with connect(settings.database_url) as conn:
        raw_id = upsert_raw_file(conn, raw)
        conn.commit()
    return payload, raw_id


def _store_ownership_list(settings: Settings, year: int) -> tuple[dict[str, Any], str]:
    url = ownership_list_url(year)
    payload = fetch_json(url)
    raw = _store_json(settings, "ksei-5pct-list", payload, url, f"ksei-5pct-list-{year}.json")
    with connect(settings.database_url) as conn:
        raw_id = upsert_raw_file(conn, raw)
        conn.commit()
    return payload, raw_id


def _download_attachment(
    conn,
    settings: Settings,
    kind: str,
    announcement_id: str,
    attachment: dict[str, Any],
) -> tuple[str, bytes]:
    pdf = fetch_bytes(attachment["FullSavePath"], accept="application/pdf,*/*")
    raw_pdf = store_raw_bytes(
        settings.raw_dir,
        kind,
        pdf,
        source_url=attachment["FullSavePath"],
        original_filename=attachment.get("OriginalFilename"),
        content_type="application/pdf",
    )
    raw_pdf_id = upsert_raw_file(conn, raw_pdf)
    link_announcement_file(
        conn,
        announcement_id,
        raw_pdf_id,
        attachment["FullSavePath"],
        attachment.get("OriginalFilename") or "",
    )
    return raw_pdf_id, pdf


def _download_file(
    conn,
    settings: Settings,
    kind: str,
    announcement_id: str,
    url: str,
    content_type: str,
) -> tuple[str, bytes]:
    content = fetch_bytes(url, accept=f"{content_type},*/*")
    raw = store_raw_bytes(
        settings.raw_dir,
        kind,
        content,
        source_url=url,
        original_filename=Path(url).name,
        content_type=content_type,
    )
    raw_id = upsert_raw_file(conn, raw)
    link_announcement_file(conn, announcement_id, raw_id, url, Path(url).name)
    return raw_id, content


def _store_json(settings: Settings, kind: str, payload: dict[str, Any], url: str, filename: str):
    return store_raw_bytes(
        settings.raw_dir,
        kind,
        json.dumps(payload, ensure_ascii=False).encode(),
        source_url=url,
        original_filename=filename,
        content_type="application/json",
    )


def _announcement_model(item: dict[str, Any], keyword: str) -> dict[str, Any]:
    p = item["pengumuman"]
    return {
        "announcement_id": p["Id2"],
        "no_pengumuman": p.get("NoPengumuman"),
        "jmsx_group_id": p.get("JMSXGroupID"),
        "title": p.get("JudulPengumuman") or "",
        "ticker": (p.get("Kode_Emiten") or "").strip() or None,
        "published_at": p.get("TglPengumuman"),
        "keyword": keyword,
        "raw_json": item,
    }


def _ownership_announcement_model(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "announcement_id": f"ksei-5pct:{item['Prospectus']}",
        "title": item.get("Description") or "Pemegang Saham di Atas 5%",
        "published_at": item.get("ListingDate"),
        "keyword": "data kepemilikan saham",
        "raw_json": item,
    }
