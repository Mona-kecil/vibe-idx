from __future__ import annotations

import datetime as dt
import json
import os
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
    SuspensionEvent,
)


def connect(database_url: str):
    path = Path(database_url.removeprefix("sqlite:///"))
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, factory=_SqliteCompat)
    conn.execute("PRAGMA foreign_keys = ON")
    with (Path(__file__).resolve().parents[4] / "db/migrations/001_init.sql").open() as file:
        conn.executescript(file.read())
    _ensure_sqlite_compat_migrations(conn)
    return conn


def sqlite_database_path(database_url: str) -> Path:
    if not database_url.startswith("sqlite:///"):
        raise ValueError("only sqlite:/// database URLs are supported")
    return Path(database_url.removeprefix("sqlite:///")).expanduser()


def backup_database(
    database_url: str,
    backup_dir: str | Path | None = None,
    now: dt.datetime | None = None,
) -> dict[str, object]:
    source_path = sqlite_database_path(database_url)
    if not source_path.exists():
        raise FileNotFoundError(f"SQLite database does not exist: {source_path}")

    destination_dir = Path(
        backup_dir
        or os.environ.get("VIBE_IDX_BACKUP_DIR")
        or source_path.parent / "backups"
    ).expanduser()
    destination_dir.mkdir(parents=True, exist_ok=True)

    timestamp = (now or dt.datetime.now(dt.UTC)).strftime("%Y%m%dT%H%M%SZ")
    destination_path = destination_dir / f"{source_path.stem}-{timestamp}.sqlite"
    if destination_path.exists():
        timestamp = (now or dt.datetime.now(dt.UTC)).strftime("%Y%m%dT%H%M%S%fZ")
        destination_path = destination_dir / f"{source_path.stem}-{timestamp}.sqlite"

    with sqlite3.connect(source_path) as source, sqlite3.connect(destination_path) as destination:
        source.backup(destination)

    return {
        "path": str(destination_path),
        "source": str(source_path),
        "size_bytes": destination_path.stat().st_size,
    }


def restore_database(database_url: str, backup_path: str | Path) -> dict[str, object]:
    source_path = Path(backup_path).expanduser()
    if not source_path.exists():
        raise FileNotFoundError(f"SQLite backup does not exist: {source_path}")

    target_path = sqlite_database_path(database_url)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target_path.with_name(f".{target_path.name}.restore-tmp")
    temp_path.unlink(missing_ok=True)

    with sqlite3.connect(f"file:{source_path}?mode=ro", uri=True) as source:
        integrity = source.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise ValueError(f"SQLite backup failed integrity_check: {integrity}")
        with sqlite3.connect(temp_path) as destination:
            source.backup(destination)

    os.replace(temp_path, target_path)
    return {
        "path": str(target_path),
        "restored_from": str(source_path),
        "size_bytes": target_path.stat().st_size,
    }


def inspect_database(database_url: str) -> dict[str, object]:
    path = sqlite_database_path(database_url)
    if not path.exists():
        return {
            "path": str(path),
            "exists": False,
            "size_bytes": 0,
            "page_count": 0,
            "page_size": 0,
            "table_count": 0,
            "tables": [],
        }

    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
        page_count = int(conn.execute("PRAGMA page_count").fetchone()[0])
        page_size = int(conn.execute("PRAGMA page_size").fetchone()[0])
        table_names = [
            str(row[0])
            for row in conn.execute(
                """
                SELECT name
                FROM sqlite_schema
                WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                ORDER BY name
                """
            ).fetchall()
        ]
        tables = [
            {"name": name, "rows": _table_row_count(conn, name)}
            for name in table_names
        ]

    return {
        "path": str(path),
        "exists": True,
        "size_bytes": path.stat().st_size,
        "page_count": page_count,
        "page_size": page_size,
        "table_count": len(tables),
        "tables": tables,
    }


def _table_row_count(conn: sqlite3.Connection, table_name: str) -> int:
    quoted_name = table_name.replace('"', '""')
    return int(conn.execute(f'SELECT COUNT(*) FROM "{quoted_name}"').fetchone()[0])


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


def _ensure_sqlite_compat_migrations(conn: sqlite3.Connection) -> None:
    columns = {
        str(row[1])
        for row in conn.execute("PRAGMA table_info(ksei_5pct_rows)").fetchall()
    }
    if "account_holder_name" not in columns:
        conn.execute("ALTER TABLE ksei_5pct_rows ADD COLUMN account_holder_name TEXT")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS idx_suspension_events (
          ticker TEXT NOT NULL,
          event_type TEXT NOT NULL CHECK (event_type IN ('SPT', 'UPT')),
          event_at TEXT NOT NULL,
          title TEXT NOT NULL,
          attachment_url TEXT,
          ingested_at TEXT NOT NULL,
          PRIMARY KEY (ticker, event_type, event_at, title)
        )
        """
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


def upsert_suspension_events(conn: Any, rows: Iterable[SuspensionEvent]) -> int:
    count = 0
    for row in rows:
        conn.execute(
            """
            INSERT INTO idx_suspension_events (
              ticker, event_type, event_at, title, attachment_url, ingested_at
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (ticker, event_type, event_at, title) DO UPDATE SET
              attachment_url = excluded.attachment_url,
              ingested_at = excluded.ingested_at
            """,
            (
                row.ticker,
                row.event_type,
                row.event_at,
                row.title,
                row.attachment_url,
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
              report_id, ticker, issuer_name, shareholder_name, account_holder_name,
              account_name, investor_status, previous_shares, previous_sid_total,
              previous_percent, current_shares, current_sid_total, current_percent,
              reported_change, actual_change
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                report_id,
                item.ticker,
                item.issuer_name,
                item.shareholder_name,
                item.account_holder_name,
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
