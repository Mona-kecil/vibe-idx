from __future__ import annotations

import datetime as dt
import json
import sqlite3
from collections.abc import Iterable
from decimal import Decimal
from pathlib import Path
from typing import Any

from idx_ingest.models import (
    Announcement,
    DailyPrice,
    InsiderReport,
    KseiFivePctReport,
    KseiOnePctReport,
    MonthlyOwnershipSnapshot,
    RawFileRef,
)


def connect(database_url: str):
    path = Path(database_url.removeprefix("sqlite:///"))
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, factory=_SqliteCompat)
    conn.execute("PRAGMA foreign_keys = ON")
    with (Path(__file__).resolve().parents[4] / "db/migrations/001_init.sql").open() as file:
        conn.executescript(file.read())
    return conn


def _json(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False)


sqlite3.register_adapter(Decimal, str)
sqlite3.register_adapter(dt.date, lambda value: value.isoformat())
sqlite3.register_adapter(dt.datetime, lambda value: value.isoformat())


class _SqliteCompat(sqlite3.Connection):
    def execute(self, sql: str, parameters: Iterable[Any] = (), /):
        return super().execute(_sqlite_sql(sql), tuple(parameters))


def _sqlite_sql(sql: str) -> str:
    return (
        sql.replace("%s::jsonb", "?")
        .replace("%s", "?")
        .replace(" IS NOT DISTINCT FROM ?", " IS ?")
    )


def upsert_raw_file(conn: Any, raw: RawFileRef) -> str:
    row = conn.execute(
        """
        INSERT INTO raw_files (
          sha256, kind, source_url, original_filename, content_type,
          size_bytes, local_path, fetched_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (sha256) DO UPDATE SET
          kind = excluded.kind,
          source_url = COALESCE(raw_files.source_url, excluded.source_url),
          original_filename = COALESCE(raw_files.original_filename, excluded.original_filename),
          content_type = COALESCE(raw_files.content_type, excluded.content_type),
          local_path = excluded.local_path
        RETURNING id
        """,
        (
            raw.sha256,
            raw.kind,
            raw.source_url,
            raw.original_filename,
            raw.content_type,
            raw.size_bytes,
            raw.local_path,
            raw.fetched_at,
        ),
    ).fetchone()
    return str(row[0])


def upsert_announcement(conn: Any, announcement: Announcement) -> str:
    row = conn.execute(
        """
        INSERT INTO idx_announcements (
          announcement_id, no_pengumuman, jmsx_group_id, title, ticker,
          published_at, keyword, raw_json, ingested_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
        ON CONFLICT (announcement_id) DO UPDATE SET
          no_pengumuman = excluded.no_pengumuman,
          jmsx_group_id = excluded.jmsx_group_id,
          title = excluded.title,
          ticker = excluded.ticker,
          published_at = excluded.published_at,
          keyword = excluded.keyword,
          raw_json = excluded.raw_json,
          ingested_at = excluded.ingested_at
        RETURNING id
        """,
        (
            announcement.announcement_id,
            announcement.no_pengumuman,
            announcement.jmsx_group_id,
            announcement.title,
            announcement.ticker,
            announcement.published_at,
            announcement.keyword,
            _json(announcement.raw_json),
            dt.datetime.now(dt.UTC),
        ),
    ).fetchone()
    return str(row[0])


def link_announcement_file(
    conn: Any,
    announcement_id: str,
    raw_file_id: str,
    attachment_url: str,
    filename: str,
) -> None:
    conn.execute(
        """
        INSERT INTO announcement_files (announcement_id, raw_file_id, attachment_url, filename)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT DO NOTHING
        """,
        (announcement_id, raw_file_id, attachment_url, filename),
    )


def record_parser_run(
    conn: Any,
    raw_file_id: str,
    parser_name: str,
    status: str,
    message: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO parser_runs (raw_file_id, parser_name, status, message, started_at, finished_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (
            raw_file_id,
            parser_name,
            status,
            message,
            dt.datetime.now(dt.UTC),
            dt.datetime.now(dt.UTC),
        ),
    )


def upsert_daily_prices(conn: Any, rows: Iterable[DailyPrice], raw_file_id: str) -> int:
    count = 0
    for row in rows:
        conn.execute(
            """
            INSERT INTO daily_prices (
              trade_date, ticker, name, previous, open, high, low, close,
              volume, value, frequency, foreign_buy, foreign_sell,
              listed_shares, tradeable_shares, raw_file_id, ingested_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (trade_date, ticker) DO UPDATE SET
              name = excluded.name,
              previous = excluded.previous,
              open = excluded.open,
              high = excluded.high,
              low = excluded.low,
              close = excluded.close,
              volume = excluded.volume,
              value = excluded.value,
              frequency = excluded.frequency,
              foreign_buy = excluded.foreign_buy,
              foreign_sell = excluded.foreign_sell,
              listed_shares = excluded.listed_shares,
              tradeable_shares = excluded.tradeable_shares,
              raw_file_id = excluded.raw_file_id,
              ingested_at = excluded.ingested_at
            """,
            (
                row.trade_date,
                row.ticker,
                row.name,
                row.previous,
                row.open,
                row.high,
                row.low,
                row.close,
                row.volume,
                row.value,
                row.frequency,
                row.foreign_buy,
                row.foreign_sell,
                row.listed_shares,
                row.tradeable_shares,
                raw_file_id,
                dt.datetime.now(dt.UTC),
            ),
        )
        count += 1
    return count


def upsert_ksei_1pct_report(
    conn: Any,
    report: KseiOnePctReport,
    announcement_id: str,
    raw_file_id: str,
) -> str:
    conn.execute(
        "UPDATE ksei_1pct_reports SET is_latest_revision = false WHERE as_of_date = %s",
        (report.as_of_date,),
    )
    revision_no = conn.execute(
        "SELECT COALESCE(MAX(revision_no), 0) + 1 FROM ksei_1pct_reports WHERE as_of_date = %s",
        (report.as_of_date,),
    ).fetchone()[0]
    row = conn.execute(
        """
        INSERT INTO ksei_1pct_reports (
          announcement_id, raw_file_id, as_of_date, revision_no,
          is_latest_revision, page_count, parse_status, ingested_at
        )
        VALUES (%s, %s, %s, %s, true, %s, 'parsed', %s)
        ON CONFLICT (as_of_date, raw_file_id) DO UPDATE SET
          page_count = excluded.page_count,
          parse_status = excluded.parse_status,
          is_latest_revision = true
        RETURNING id
        """,
        (
            announcement_id,
            raw_file_id,
            report.as_of_date,
            revision_no,
            report.page_count,
            dt.datetime.now(dt.UTC),
        ),
    ).fetchone()
    report_id = str(row[0])
    conn.execute("DELETE FROM ksei_1pct_rows WHERE report_id = %s", (report_id,))
    for item in report.rows:
        conn.execute(
            """
            INSERT INTO ksei_1pct_rows (
              report_id, as_of_date, ticker, issuer_name, investor_name,
              investor_classification, local_foreign, nationality, domicile,
              holdings_scripless, holdings_scrip, total_holding_shares, percentage
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                report_id,
                item.as_of_date,
                item.ticker,
                item.issuer_name,
                item.investor_name,
                item.investor_classification,
                item.local_foreign,
                item.nationality,
                item.domicile,
                item.holdings_scripless,
                item.holdings_scrip,
                item.total_holding_shares,
                item.percentage,
            ),
        )
    return report_id


def upsert_ksei_5pct_report(
    conn: Any,
    report: KseiFivePctReport,
    announcement_id: str,
    raw_file_id: str,
) -> str:
    conn.execute(
        """
        UPDATE ksei_5pct_reports
        SET is_latest_revision = false
        WHERE previous_date IS NOT DISTINCT FROM %s AND as_of_date = %s
        """,
        (report.previous_date, report.as_of_date),
    )
    revision_no = conn.execute(
        """
        SELECT COALESCE(MAX(revision_no), 0) + 1
        FROM ksei_5pct_reports
        WHERE previous_date IS NOT DISTINCT FROM %s AND as_of_date = %s
        """,
        (report.previous_date, report.as_of_date),
    ).fetchone()[0]
    row = conn.execute(
        """
        INSERT INTO ksei_5pct_reports (
          announcement_id, raw_file_id, previous_date, as_of_date, source_date,
          revision_no, is_latest_revision, page_count, parse_status, ingested_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, true, %s, 'parsed', %s)
        ON CONFLICT (previous_date, as_of_date, raw_file_id) DO UPDATE SET
          source_date = excluded.source_date,
          page_count = excluded.page_count,
          parse_status = excluded.parse_status,
          is_latest_revision = true
        RETURNING id
        """,
        (
            announcement_id,
            raw_file_id,
            report.previous_date,
            report.as_of_date,
            report.source_date,
            revision_no,
            report.page_count,
            dt.datetime.now(dt.UTC),
        ),
    ).fetchone()
    report_id = str(row[0])
    conn.execute("DELETE FROM ksei_5pct_rows WHERE report_id = %s", (report_id,))
    for item in report.rows:
        conn.execute(
            """
            INSERT INTO ksei_5pct_rows (
              report_id, ticker, issuer_name, shareholder_name, account_name,
              investor_status, previous_shares, previous_sid_total,
              previous_percent, current_shares, current_sid_total,
              current_percent, reported_change, actual_change
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                report_id,
                item.ticker,
                item.issuer_name,
                item.shareholder_name,
                item.account_name,
                item.investor_status,
                item.previous_shares,
                item.previous_sid_total,
                item.previous_percent,
                item.current_shares,
                item.current_sid_total,
                item.current_percent,
                item.reported_change,
                item.actual_change,
            ),
        )
    return report_id


def upsert_insider_report(
    conn: Any,
    report: InsiderReport,
    announcement_id: str,
    raw_file_id: str,
) -> str:
    row = conn.execute(
        """
        INSERT INTO insider_reports (
          announcement_id, raw_file_id, ticker, issuer_name, reporter_name,
          sid_name, position, is_director_or_commissioner, shares_before,
          voting_percent_before, shares_after, voting_percent_after,
          delta_total, is_controller, will_maintain_control, parse_status, ingested_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'parsed', %s)
        ON CONFLICT (announcement_id, raw_file_id) DO UPDATE SET
          ticker = excluded.ticker,
          issuer_name = excluded.issuer_name,
          reporter_name = excluded.reporter_name,
          sid_name = excluded.sid_name,
          position = excluded.position,
          is_director_or_commissioner = excluded.is_director_or_commissioner,
          shares_before = excluded.shares_before,
          voting_percent_before = excluded.voting_percent_before,
          shares_after = excluded.shares_after,
          voting_percent_after = excluded.voting_percent_after,
          delta_total = excluded.delta_total,
          is_controller = excluded.is_controller,
          will_maintain_control = excluded.will_maintain_control,
          parse_status = excluded.parse_status,
          ingested_at = excluded.ingested_at
        RETURNING id
        """,
        (
            announcement_id,
            raw_file_id,
            report.ticker,
            report.issuer_name,
            report.reporter_name,
            report.sid_name,
            report.position,
            report.is_director_or_commissioner,
            report.shares_before,
            report.voting_percent_before,
            report.shares_after,
            report.voting_percent_after,
            report.delta_total,
            report.is_controller,
            report.will_maintain_control,
            dt.datetime.now(dt.UTC),
        ),
    ).fetchone()
    report_id = str(row[0])
    conn.execute("DELETE FROM insider_transactions WHERE report_id = %s", (report_id,))
    for tx in report.transactions:
        conn.execute(
            """
            INSERT INTO insider_transactions (
              report_id, transaction_type_raw, transaction_type, is_repo,
              ownership_status, direct_owner_name, unexercised_amount,
              exercise_deadline, shares, share_classification, price,
              transaction_date, purpose
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                report_id,
                tx.transaction_type_raw,
                tx.transaction_type,
                tx.is_repo,
                tx.ownership_status,
                tx.direct_owner_name,
                tx.unexercised_amount,
                tx.exercise_deadline,
                tx.shares,
                tx.share_classification,
                tx.price,
                tx.transaction_date,
                tx.purpose,
            ),
        )
    return report_id


def upsert_monthly_snapshot(
    conn: Any,
    snapshot: MonthlyOwnershipSnapshot,
    announcement_id: str,
    raw_file_id: str,
) -> str:
    row = conn.execute(
        """
        INSERT INTO monthly_ownership_snapshots (
          announcement_id, raw_file_id, ticker, issuer_name, report_month,
          registrar, total_shares, treasury_shares, scrip_shares,
          scripless_shares, reported_free_float_percent, parse_status, ingested_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'parsed', %s)
        ON CONFLICT (announcement_id, raw_file_id) DO UPDATE SET
          ticker = excluded.ticker,
          issuer_name = excluded.issuer_name,
          report_month = excluded.report_month,
          registrar = excluded.registrar,
          total_shares = excluded.total_shares,
          treasury_shares = excluded.treasury_shares,
          scrip_shares = excluded.scrip_shares,
          scripless_shares = excluded.scripless_shares,
          reported_free_float_percent = excluded.reported_free_float_percent,
          parse_status = excluded.parse_status,
          ingested_at = excluded.ingested_at
        RETURNING id
        """,
        (
            announcement_id,
            raw_file_id,
            snapshot.ticker,
            snapshot.issuer_name,
            snapshot.report_month,
            snapshot.registrar,
            snapshot.total_shares,
            snapshot.treasury_shares,
            snapshot.scrip_shares,
            snapshot.scripless_shares,
            snapshot.reported_free_float_percent,
            dt.datetime.now(dt.UTC),
        ),
    ).fetchone()
    return str(row[0])
