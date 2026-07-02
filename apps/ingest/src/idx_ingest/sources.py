from __future__ import annotations

import calendar
import datetime as dt
from dataclasses import asdict, dataclass
from typing import Literal

SourceName = Literal["market-summary", "ksei-5pct", "insider", "ksei-1pct", "laporan-efek"]
UpdateFrequency = Literal["daily", "monthly"]


@dataclass(frozen=True, slots=True)
class SourcePolicy:
    name: SourceName
    update_frequency: UpdateFrequency
    source_route: str
    latest_strategy: str
    historical_date_basis: str
    selection_rule: str
    default_lookback_days: int | None = None
    keyword: str | None = None
    title_filter: str | None = None

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


SOURCES: dict[SourceName, SourcePolicy] = {
    "market-summary": SourcePolicy(
        name="market-summary",
        update_frequency="daily",
        source_route="TradingSummary/GetStockSummary",
        latest_strategy="walk_back_to_latest_populated_trading_summary",
        historical_date_basis="trade_date",
        selection_rule="first_populated_date",
        default_lookback_days=10,
    ),
    "ksei-5pct": SourcePolicy(
        name="ksei-5pct",
        update_frequency="daily",
        source_route="data-kepemilikan-saham ownership list",
        latest_strategy="newest_available_ownership_list_file",
        historical_date_basis="listing_date",
        selection_rule="first_item_with_prospectus",
        keyword="data kepemilikan saham",
    ),
    "insider": SourcePolicy(
        name="insider",
        update_frequency="daily",
        source_route="ListedCompany/GetAnnouncement",
        latest_strategy="latest_matching_publication_day",
        historical_date_basis="idx_disclosure_publish_date",
        selection_rule="all_matching_reports_on_latest_day",
        default_lookback_days=14,
        keyword="laporan kepemilikan",
        title_filter="laporan kepemilikan atau setiap perubahan kepemilikan saham",
    ),
    "ksei-1pct": SourcePolicy(
        name="ksei-1pct",
        update_frequency="monthly",
        source_route="ListedCompany/GetAnnouncement",
        latest_strategy="lookback_window_top_matching_monthly_disclosure",
        historical_date_basis="idx_disclosure_publish_month",
        selection_rule="first_matching_title",
        default_lookback_days=90,
        keyword="1%",
        title_filter="Pemegang Saham di atas 1% (KSEI)",
    ),
    "laporan-efek": SourcePolicy(
        name="laporan-efek",
        update_frequency="monthly",
        source_route="ListedCompany/GetAnnouncement",
        latest_strategy="lookback_window_top_monthly_disclosure",
        historical_date_basis="idx_disclosure_publish_month",
        selection_rule="top_search_result",
        default_lookback_days=90,
        keyword="laporan efek",
    ),
}


def source_policy(name: SourceName | str) -> SourcePolicy:
    return SOURCES[name]  # type: ignore[index]


def month_window(value: str) -> tuple[dt.date, dt.date]:
    year_text, month_text = value.split("-", maxsplit=1)
    year = int(year_text)
    month = int(month_text)
    last_day = calendar.monthrange(year, month)[1]
    return dt.date(year, month, 1), dt.date(year, month, last_day)


def previous_month_window(today: dt.date) -> tuple[dt.date, dt.date]:
    first_of_month = today.replace(day=1)
    previous_month = first_of_month - dt.timedelta(days=1)
    return month_window(previous_month.strftime("%Y-%m"))
