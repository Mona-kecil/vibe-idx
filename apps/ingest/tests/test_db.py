from __future__ import annotations

import sqlite3
from pathlib import Path

from idx_ingest.db import connect


def test_connect_adds_account_holder_column_to_existing_5pct_table(tmp_path: Path) -> None:
    db_path = tmp_path / "vibe_idx.sqlite"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE ksei_5pct_rows (
              id TEXT PRIMARY KEY,
              report_id TEXT NOT NULL,
              ticker TEXT NOT NULL,
              issuer_name TEXT,
              shareholder_name TEXT,
              account_name TEXT
            )
            """
        )
        conn.execute(
            """
            INSERT INTO ksei_5pct_rows (
              id, report_id, ticker, issuer_name, shareholder_name, account_name
            )
            VALUES ('row-1', 'report-1', 'AADI', 'Issuer', 'Shareholder', 'Account')
            """
        )

    with connect(f"sqlite:///{db_path}") as conn:
        columns = {
            str(row[1])
            for row in conn.execute("PRAGMA table_info(ksei_5pct_rows)").fetchall()
        }
        row = conn.execute(
            """
            SELECT ticker, shareholder_name, account_name, account_holder_name
            FROM ksei_5pct_rows
            WHERE id = 'row-1'
            """
        ).fetchone()

    assert "account_holder_name" in columns
    assert row == ("AADI", "Shareholder", "Account", None)
