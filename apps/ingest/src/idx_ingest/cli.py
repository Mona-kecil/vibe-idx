from __future__ import annotations

import datetime as dt
import json

import typer

from idx_ingest.ingest import (
    ingest_insider,
    ingest_ksei_1pct,
    ingest_ksei_5pct,
    ingest_laporan_efek,
    ingest_market_summary,
)
from idx_ingest.util import parse_cli_date

app = typer.Typer(no_args_is_help=True)


@app.command("market-summary")
def market_summary(date: str | None = None) -> None:
    _print(ingest_market_summary(_date_or_today(date)))


@app.command("ksei-5pct")
def ksei_5pct(
    date_from: str | None = typer.Option(None, "--from"),
    date_to: str | None = typer.Option(None, "--to"),
) -> None:
    start, end = _date_range(date_from, date_to)
    _print(ingest_ksei_5pct(start, end))


@app.command("ksei-1pct")
def ksei_1pct(
    date_from: str | None = typer.Option(None, "--from"),
    date_to: str | None = typer.Option(None, "--to"),
    page_size: int = 50,
) -> None:
    start, end = _date_range(date_from, date_to)
    _print(ingest_ksei_1pct(start, end, page_size))


@app.command("insider")
def insider(
    date_from: str | None = typer.Option(None, "--from"),
    date_to: str | None = typer.Option(None, "--to"),
    page_size: int = 50,
) -> None:
    start, end = _date_range(date_from, date_to)
    _print(ingest_insider(start, end, page_size))


@app.command("laporan-efek")
def laporan_efek(
    date_from: str | None = typer.Option(None, "--from"),
    date_to: str | None = typer.Option(None, "--to"),
    page_size: int = 50,
) -> None:
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
