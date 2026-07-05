from __future__ import annotations

import datetime as dt
import json
import time

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


@app.command("backfill-year")
def backfill_year(
    year: int | None = typer.Option(None, "--year"),
    date_from: str | None = typer.Option(None, "--from"),
    date_to: str | None = typer.Option(None, "--to"),
    daily_window_days: int = typer.Option(7, "--daily-window-days"),
    pause_seconds: float = typer.Option(1.0, "--pause-seconds"),
    continue_on_error: bool = typer.Option(False, "--continue-on-error"),
    page_size: int = 50,
) -> None:
    start, end, selected_year = _year_range(year, date_from, date_to)
    if daily_window_days < 1:
        raise typer.BadParameter("--daily-window-days must be at least 1")
    if pause_seconds < 0:
        raise typer.BadParameter("--pause-seconds must be zero or greater")

    daily_windows = list(_date_windows(start, end, daily_window_days))
    monthly_windows = list(_month_windows(start, end))
    total_periods = len(daily_windows) + len(monthly_windows)
    periods: list[dict[str, object]] = []
    totals: dict[str, dict[str, int]] = {}
    errors: list[dict[str, str]] = []
    completed_periods = 0

    for window_start, window_end in daily_windows:
        results: list[dict[str, object]] = []
        for date in _dates_between(window_start, window_end):
            result = _run_backfill_source(
                "market-summary",
                date,
                date,
                lambda date=date: ingest_market_summary(date),
                continue_on_error,
                errors,
            )
            if result is not None:
                _merge_totals(totals, "market-summary", result)
                results.append(
                    {"source": "market-summary", "date": date.isoformat(), "result": result}
                )

        result = _run_backfill_source(
            "ksei-5pct",
            window_start,
            window_end,
            lambda start=window_start, end=window_end: ingest_ksei_5pct(
                start,
                end,
                continue_on_error=continue_on_error,
            ),
            continue_on_error,
            errors,
        )
        if result is not None:
            _merge_totals(totals, "ksei-5pct", result)
            results.append(_period_result("ksei-5pct", window_start, window_end, result))

        result = _run_backfill_source(
            "insider",
            window_start,
            window_end,
            lambda start=window_start, end=window_end: ingest_insider(
                start,
                end,
                page_size,
            ),
            continue_on_error,
            errors,
        )
        if result is not None:
            _merge_totals(totals, "insider", result)
            results.append(_period_result("insider", window_start, window_end, result))

        periods.append(
            {
                "frequency": "daily",
                "from": window_start.isoformat(),
                "to": window_end.isoformat(),
                "results": results,
            }
        )
        completed_periods += 1
        _pause_between_periods(completed_periods, total_periods, pause_seconds)

    for window_start, window_end in monthly_windows:
        results = []

        result = _run_backfill_source(
            "ksei-1pct",
            window_start,
            window_end,
            lambda start=window_start, end=window_end: ingest_ksei_1pct(
                start,
                end,
                page_size,
            ),
            continue_on_error,
            errors,
        )
        if result is not None:
            _merge_totals(totals, "ksei-1pct", result)
            results.append(_period_result("ksei-1pct", window_start, window_end, result))

        result = _run_backfill_source(
            "laporan-efek",
            window_start,
            window_end,
            lambda start=window_start, end=window_end: ingest_laporan_efek(
                start,
                end,
                page_size,
            ),
            continue_on_error,
            errors,
        )
        if result is not None:
            _merge_totals(totals, "laporan-efek", result)
            results.append(_period_result("laporan-efek", window_start, window_end, result))

        periods.append(
            {
                "frequency": "monthly",
                "from": window_start.isoformat(),
                "to": window_end.isoformat(),
                "results": results,
            }
        )
        completed_periods += 1
        _pause_between_periods(completed_periods, total_periods, pause_seconds)

    _print(
        {
            "year": selected_year,
            "from": start.isoformat(),
            "to": end.isoformat(),
            "daily_window_days": daily_window_days,
            "pause_seconds": pause_seconds,
            "continue_on_error": continue_on_error,
            "periods": total_periods,
            "totals": totals,
            "errors": errors,
            "runs": periods,
        }
    )


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


def _year_range(
    year: int | None,
    date_from: str | None,
    date_to: str | None,
) -> tuple[dt.date, dt.date, int]:
    today = _today()
    selected_year = year or today.year
    if selected_year > today.year:
        raise typer.BadParameter("--year cannot be in the future")

    start = parse_cli_date(date_from) if date_from else dt.date(selected_year, 1, 1)
    if date_to:
        end = parse_cli_date(date_to)
    elif selected_year == today.year:
        end = today
    else:
        end = dt.date(selected_year, 12, 31)

    if start.year != selected_year or end.year != selected_year:
        raise typer.BadParameter("--from and --to must stay within --year")
    if end < start:
        raise typer.BadParameter("--to must be on or after --from")
    return start, end, selected_year


def _date_windows(
    start: dt.date,
    end: dt.date,
    window_days: int,
) -> list[tuple[dt.date, dt.date]]:
    windows = []
    current = start
    while current <= end:
        window_end = min(current + dt.timedelta(days=window_days - 1), end)
        windows.append((current, window_end))
        current = window_end + dt.timedelta(days=1)
    return windows


def _month_windows(start: dt.date, end: dt.date) -> list[tuple[dt.date, dt.date]]:
    windows = []
    current = start.replace(day=1)
    while current <= end:
        month_start, month_end = month_window(current.strftime("%Y-%m"))
        windows.append((max(start, month_start), min(end, month_end)))
        current = month_end + dt.timedelta(days=1)
    return windows


def _dates_between(start: dt.date, end: dt.date) -> list[dt.date]:
    return [start + dt.timedelta(days=offset) for offset in range((end - start).days + 1)]


def _period_result(
    source: str,
    date_from: dt.date,
    date_to: dt.date,
    result: dict[str, int | str],
) -> dict[str, object]:
    return {
        "source": source,
        "from": date_from.isoformat(),
        "to": date_to.isoformat(),
        "result": result,
    }


def _merge_totals(
    totals: dict[str, dict[str, int]],
    source: str,
    result: dict[str, int | str],
) -> None:
    source_totals = totals.setdefault(source, {})
    for key, value in result.items():
        if isinstance(value, int):
            source_totals[key] = source_totals.get(key, 0) + value


def _run_backfill_source(
    source: str,
    date_from: dt.date,
    date_to: dt.date,
    operation,
    continue_on_error: bool,
    errors: list[dict[str, str]],
) -> dict[str, int | str] | None:
    try:
        return operation()
    except Exception as exc:
        if not continue_on_error:
            raise
        errors.append(
            {
                "source": source,
                "from": date_from.isoformat(),
                "to": date_to.isoformat(),
                "error": str(exc),
            }
        )
        return None


def _pause_between_periods(
    completed_periods: int,
    total_periods: int,
    pause_seconds: float,
) -> None:
    if pause_seconds and completed_periods < total_periods:
        time.sleep(pause_seconds)
