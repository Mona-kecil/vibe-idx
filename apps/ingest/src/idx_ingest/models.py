from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal


@dataclass(slots=True)
class RawFileRef:
    sha256: str
    kind: str
    size_bytes: int
    local_path: str
    fetched_at: dt.datetime
    source_url: str | None = None
    original_filename: str | None = None
    content_type: str | None = None
    id: str | None = None


@dataclass(slots=True)
class Announcement:
    announcement_id: str
    title: str
    keyword: str
    raw_json: dict[str, Any]
    no_pengumuman: str | None = None
    jmsx_group_id: str | None = None
    ticker: str | None = None
    published_at: dt.datetime | None = None


@dataclass(slots=True)
class DailyPrice:
    trade_date: dt.date
    ticker: str
    name: str | None = None
    previous: Decimal | None = None
    open: Decimal | None = None
    high: Decimal | None = None
    low: Decimal | None = None
    close: Decimal | None = None
    volume: int | None = None
    value: Decimal | None = None
    frequency: int | None = None
    foreign_buy: int | None = None
    foreign_sell: int | None = None
    listed_shares: int | None = None
    tradeable_shares: int | None = None


@dataclass(slots=True)
class KseiFivePctRow:
    ticker: str
    issuer_name: str | None = None
    shareholder_name: str | None = None
    account_name: str | None = None
    investor_status: str | None = None
    previous_shares: int | None = None
    previous_sid_total: int | None = None
    previous_percent: Decimal | None = None
    current_shares: int | None = None
    current_sid_total: int | None = None
    current_percent: Decimal | None = None
    reported_change: int | None = None
    actual_change: int | None = None


@dataclass(slots=True)
class KseiFivePctReport:
    as_of_date: dt.date
    previous_date: dt.date | None = None
    source_date: dt.date | None = None
    page_count: int = 0
    rows: list[KseiFivePctRow] = field(default_factory=list)


@dataclass(slots=True)
class KseiOnePctRow:
    as_of_date: dt.date
    ticker: str
    issuer_name: str
    investor_name: str
    investor_classification: str | None = None
    local_foreign: str | None = None
    nationality: str | None = None
    domicile: str | None = None
    holdings_scripless: int | None = None
    holdings_scrip: int | None = None
    total_holding_shares: int | None = None
    percentage: Decimal | None = None


@dataclass(slots=True)
class KseiOnePctReport:
    as_of_date: dt.date
    page_count: int
    rows: list[KseiOnePctRow]


TransactionType = Literal["BUY", "SELL", "BUYBACK", "GRANT", "TRANSFER", "OTHER"]


@dataclass(slots=True)
class InsiderTransaction:
    transaction_type_raw: str
    transaction_type: TransactionType
    is_repo: bool | None = None
    ownership_status: str | None = None
    direct_owner_name: str | None = None
    unexercised_amount: int | None = None
    exercise_deadline: dt.date | None = None
    shares: int | None = None
    share_classification: str | None = None
    price: Decimal | None = None
    transaction_date: dt.date | None = None
    purpose: str | None = None


@dataclass(slots=True)
class InsiderReport:
    ticker: str | None = None
    issuer_name: str | None = None
    reporter_name: str | None = None
    sid_name: str | None = None
    position: str | None = None
    is_director_or_commissioner: bool | None = None
    shares_before: int | None = None
    voting_percent_before: Decimal | None = None
    shares_after: int | None = None
    voting_percent_after: Decimal | None = None
    delta_total: int | None = None
    is_controller: bool | None = None
    will_maintain_control: bool | None = None
    transactions: list[InsiderTransaction] = field(default_factory=list)


@dataclass(slots=True)
class MonthlyOwnershipSnapshot:
    ticker: str | None = None
    issuer_name: str | None = None
    report_month: str | None = None
    registrar: str | None = None
    total_shares: int | None = None
    treasury_shares: int | None = None
    scrip_shares: int | None = None
    scripless_shares: int | None = None
    reported_free_float_percent: Decimal | None = None
