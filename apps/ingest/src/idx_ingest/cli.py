from __future__ import annotations

import datetime as dt
import json

import typer

from idx_ingest.ingest import (
    ingest_insider,
    ingest_ksei_1pct,
    ingest_ksei_5pct,
    ingest_laporan_efek,
    ingest_latest_insider,
    ingest_latest_ksei_1pct,
    ingest_latest_ksei_5pct,
    ingest_latest_laporan_efek,
    ingest_latest_market_summary,
    ingest_market_summary,
    ingest_suspension_events,
)
from idx_ingest.sources import SOURCES, month_window, previous_month_window, source_policy
from idx_ingest.util import parse_cli_date

app = typer.Typer(no_args_is_help=True)


@app.command("sources")
def sources(source: str | None = typer.Argument(None)) -> None:
    if source:
        if source not in SOURCES:
            raise typer.BadParameter(f"unknown source: {source}")
        _print(source_policy(source).as_dict())
        return
    _print({name: policy.as_dict() for name, policy in SOURCES.items()})


@app.command("market-summary")
def market_summary(date: str | None = None) -> None:
    if date:
        _print(ingest_market_summary(_date_or_today(date)))
        return
    _print(ingest_latest_market_summary())


@app.command("suspension-events")
def suspension_events(page_size: int = 9999) -> None:
    _print(ingest_suspension_events(page_size=page_size))


@app.command("ksei-5pct")
def ksei_5pct(
    date_from: str | None = typer.Option(None, "--from"),
    date_to: str | None = typer.Option(None, "--to"),
) -> None:
    if date_from is None and date_to is None:
        _print(ingest_latest_ksei_5pct())
        return
    start, end = _date_range(date_from, date_to)
    _print(ingest_ksei_5pct(start, end))


@app.command("ksei-1pct")
def ksei_1pct(
    date_from: str | None = typer.Option(None, "--from"),
    date_to: str | None = typer.Option(None, "--to"),
    month: str | None = typer.Option(None, "--month"),
    period: str | None = typer.Option(None, "--period"),
    page_size: int = 50,
) -> None:
    _validate_monthly_options(date_from, date_to, month, period)
    if month is not None:
        start, end = month_window(month)
        _print(ingest_ksei_1pct(start, end, page_size))
        return
    if period == "previous-month":
        start, end = previous_month_window(_today())
        _print(ingest_ksei_1pct(start, end, page_size))
        return
    if date_from is None and date_to is None:
        _print(ingest_latest_ksei_1pct(page_size=page_size))
        return
    start, end = _date_range(date_from, date_to)
    _print(ingest_ksei_1pct(start, end, page_size))


@app.command("insider")
def insider(
    date_from: str | None = typer.Option(None, "--from"),
    date_to: str | None = typer.Option(None, "--to"),
    page_size: int = 50,
) -> None:
    if date_from is None and date_to is None:
        _print(ingest_latest_insider(page_size=page_size))
        return
    start, end = _date_range(date_from, date_to)
    _print(ingest_insider(start, end, page_size))


@app.command("laporan-efek")
def laporan_efek(
    date_from: str | None = typer.Option(None, "--from"),
    date_to: str | None = typer.Option(None, "--to"),
    month: str | None = typer.Option(None, "--month"),
    period: str | None = typer.Option(None, "--period"),
    page_size: int = 50,
) -> None:
    _validate_monthly_options(date_from, date_to, month, period)
    if month is not None:
        start, end = month_window(month)
        _print(ingest_laporan_efek(start, end, page_size))
        return
    if period == "previous-month":
        start, end = previous_month_window(_today())
        _print(ingest_laporan_efek(start, end, page_size))
        return
    if date_from is None and date_to is None:
        _print(ingest_latest_laporan_efek(page_size=page_size))
        return
    start, end = _date_range(date_from, date_to)
    _print(ingest_laporan_efek(start, end, page_size))


def _print(data: object) -> None:
    typer.echo(json.dumps(data, ensure_ascii=False, indent=2, default=str))


def _date_or_today(value: str | None):
    return parse_cli_date(value) if value else dt.date.today()


def _date_range(date_from: str | None, date_to: str | None):
    end = _date_or_today(date_to or date_from)
    start = _date_or_today(date_from or date_to)
    return start, end


def _today() -> dt.date:
    return dt.date.today()


def _validate_monthly_options(
    date_from: str | None,
    date_to: str | None,
    month: str | None,
    period: str | None,
) -> None:
    if period not in {None, "latest", "previous-month"}:
        raise typer.BadParameter("--period must be latest or previous-month")

    has_dates = date_from is not None or date_to is not None
    if period == "latest" and (has_dates or month is not None):
        raise typer.BadParameter("--period latest cannot be combined with historical options")
    if period == "previous-month" and (has_dates or month is not None):
        raise typer.BadParameter(
            "--period previous-month cannot be combined with historical options"
        )
    if month is not None and has_dates:
        raise typer.BadParameter("--month cannot be combined with --from or --to")
