from __future__ import annotations

import datetime as dt
import json

from typer.testing import CliRunner

from idx_ingest import cli
from idx_ingest.cli import _date_range

runner = CliRunner()


def test_date_range_defaults_to_single_latest_day() -> None:
    today = dt.date.today()
    assert _date_range(None, None) == (today, today)


def test_date_range_accepts_one_sided_historical_date() -> None:
    date = dt.date(2026, 6, 25)
    assert _date_range("2026-06-25", None) == (date, date)
    assert _date_range(None, "20260625") == (date, date)


def test_no_arg_commands_use_latest_aware_ingest(monkeypatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(
        cli,
        "ingest_latest_market_summary",
        lambda: calls.append("market-summary") or {"rows": 1},
    )
    monkeypatch.setattr(
        cli,
        "ingest_latest_ksei_5pct",
        lambda: calls.append("ksei-5pct") or {"reports": 1},
    )
    monkeypatch.setattr(
        cli,
        "ingest_latest_ksei_1pct",
        lambda **kwargs: calls.append("ksei-1pct") or {"reports": 1},
    )
    monkeypatch.setattr(
        cli,
        "ingest_latest_insider",
        lambda **kwargs: calls.append("insider") or {"reports": 1},
    )
    monkeypatch.setattr(
        cli,
        "ingest_latest_laporan_efek",
        lambda **kwargs: calls.append("laporan-efek") or {"snapshots": 1},
    )

    for command in ("market-summary", "ksei-5pct", "ksei-1pct", "insider", "laporan-efek"):
        result = runner.invoke(cli.app, [command])
        assert result.exit_code == 0
        assert json.loads(result.output)

    assert calls == ["market-summary", "ksei-5pct", "ksei-1pct", "insider", "laporan-efek"]


def test_sources_command_prints_source_policy_metadata() -> None:
    result = runner.invoke(cli.app, ["sources", "ksei-1pct"])

    assert result.exit_code == 0
    data = json.loads(result.output)
    assert data["name"] == "ksei-1pct"
    assert data["update_frequency"] == "monthly"
    assert data["keyword"] == "1%"


def test_month_option_routes_monthly_sources_to_full_month(monkeypatch) -> None:
    calls: list[tuple[str, dt.date, dt.date]] = []

    monkeypatch.setattr(
        cli,
        "ingest_ksei_1pct",
        lambda start, end, page_size: calls.append(("ksei-1pct", start, end))
        or {"reports": 1},
    )
    monkeypatch.setattr(
        cli,
        "ingest_laporan_efek",
        lambda start, end, page_size: calls.append(("laporan-efek", start, end))
        or {"snapshots": 1},
    )

    for command in ("ksei-1pct", "laporan-efek"):
        result = runner.invoke(cli.app, [command, "--month", "2026-06"])
        assert result.exit_code == 0

    assert calls == [
        ("ksei-1pct", dt.date(2026, 6, 1), dt.date(2026, 6, 30)),
        ("laporan-efek", dt.date(2026, 6, 1), dt.date(2026, 6, 30)),
    ]


def test_previous_month_period_routes_monthly_source_to_previous_month(monkeypatch) -> None:
    calls: list[tuple[dt.date, dt.date]] = []

    monkeypatch.setattr(cli, "_today", lambda: dt.date(2026, 7, 2))
    monkeypatch.setattr(
        cli,
        "ingest_ksei_1pct",
        lambda start, end, page_size: calls.append((start, end)) or {"reports": 1},
    )

    result = runner.invoke(cli.app, ["ksei-1pct", "--period", "previous-month"])

    assert result.exit_code == 0
    assert calls == [(dt.date(2026, 6, 1), dt.date(2026, 6, 30))]


def test_latest_period_rejects_explicit_historical_dates() -> None:
    result = runner.invoke(
        cli.app,
        ["ksei-1pct", "--period", "latest", "--from", "2026-06-01"],
    )

    assert result.exit_code != 0
    assert "--period latest cannot be combined with historical options" in result.output
