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


def test_backfill_year_routes_sources_in_paced_periods(monkeypatch) -> None:
    calls: list[tuple] = []
    pauses: list[float] = []

    monkeypatch.setattr(
        cli,
        "ingest_market_summary",
        lambda date: calls.append(("market-summary", date)) or {"rows": 1},
    )
    monkeypatch.setattr(
        cli,
        "ingest_ksei_5pct",
        lambda start, end, **kwargs: calls.append(("ksei-5pct", start, end))
        or {"reports": 1},
    )
    monkeypatch.setattr(
        cli,
        "ingest_insider",
        lambda start, end, page_size: calls.append(("insider", start, end, page_size))
        or {"reports": 1},
    )
    monkeypatch.setattr(
        cli,
        "ingest_ksei_1pct",
        lambda start, end, page_size: calls.append(("ksei-1pct", start, end, page_size))
        or {"reports": 1},
    )
    monkeypatch.setattr(
        cli,
        "ingest_laporan_efek",
        lambda start, end, page_size: calls.append(("laporan-efek", start, end, page_size))
        or {"snapshots": 1},
    )
    monkeypatch.setattr(cli.time, "sleep", lambda seconds: pauses.append(seconds))

    result = runner.invoke(
        cli.app,
        [
            "backfill-year",
            "--year",
            "2026",
            "--to",
            "2026-01-05",
            "--daily-window-days",
            "2",
            "--pause-seconds",
            "0.25",
            "--page-size",
            "17",
        ],
    )

    assert result.exit_code == 0
    assert calls == [
        ("market-summary", dt.date(2026, 1, 1)),
        ("market-summary", dt.date(2026, 1, 2)),
        ("ksei-5pct", dt.date(2026, 1, 1), dt.date(2026, 1, 2)),
        ("insider", dt.date(2026, 1, 1), dt.date(2026, 1, 2), 17),
        ("market-summary", dt.date(2026, 1, 3)),
        ("market-summary", dt.date(2026, 1, 4)),
        ("ksei-5pct", dt.date(2026, 1, 3), dt.date(2026, 1, 4)),
        ("insider", dt.date(2026, 1, 3), dt.date(2026, 1, 4), 17),
        ("market-summary", dt.date(2026, 1, 5)),
        ("ksei-5pct", dt.date(2026, 1, 5), dt.date(2026, 1, 5)),
        ("insider", dt.date(2026, 1, 5), dt.date(2026, 1, 5), 17),
        ("ksei-1pct", dt.date(2026, 1, 1), dt.date(2026, 1, 5), 17),
        ("laporan-efek", dt.date(2026, 1, 1), dt.date(2026, 1, 5), 17),
    ]
    assert pauses == [0.25, 0.25, 0.25]
    assert json.loads(result.output)["periods"] == 4


def test_backfill_year_can_continue_after_source_error(monkeypatch) -> None:
    calls: list[tuple] = []

    monkeypatch.setattr(
        cli,
        "ingest_market_summary",
        lambda date: calls.append(("market-summary", date)) or {"rows": 1},
    )

    def fail_ksei_5pct(start: dt.date, end: dt.date, **kwargs) -> dict[str, int]:
        calls.append(("ksei-5pct", start, end))
        raise ValueError("bad historical XLSX")

    monkeypatch.setattr(cli, "ingest_ksei_5pct", fail_ksei_5pct)
    monkeypatch.setattr(
        cli,
        "ingest_insider",
        lambda start, end, page_size: calls.append(("insider", start, end, page_size))
        or {"reports": 1},
    )
    monkeypatch.setattr(
        cli,
        "ingest_ksei_1pct",
        lambda start, end, page_size: calls.append(("ksei-1pct", start, end, page_size))
        or {"reports": 1},
    )
    monkeypatch.setattr(
        cli,
        "ingest_laporan_efek",
        lambda start, end, page_size: calls.append(("laporan-efek", start, end, page_size))
        or {"snapshots": 1},
    )

    result = runner.invoke(
        cli.app,
        [
            "backfill-year",
            "--year",
            "2026",
            "--to",
            "2026-01-01",
            "--pause-seconds",
            "0",
            "--continue-on-error",
        ],
    )

    assert result.exit_code == 0
    assert calls == [
        ("market-summary", dt.date(2026, 1, 1)),
        ("ksei-5pct", dt.date(2026, 1, 1), dt.date(2026, 1, 1)),
        ("insider", dt.date(2026, 1, 1), dt.date(2026, 1, 1), 50),
        ("ksei-1pct", dt.date(2026, 1, 1), dt.date(2026, 1, 1), 50),
        ("laporan-efek", dt.date(2026, 1, 1), dt.date(2026, 1, 1), 50),
    ]
    output = json.loads(result.output)
    assert output["errors"] == [
        {
            "source": "ksei-5pct",
            "from": "2026-01-01",
            "to": "2026-01-01",
            "error": "bad historical XLSX",
        }
    ]
