import type { z } from 'zod';
import type { corporateActionSchema, Ticker } from '../data';
import { dateText, publishedMs } from './format';

export type Price = Ticker['prices'][number];
export type Filing = Ticker['disclosures'][number];
export type Selection = { anchor: string; end: string } | null;
export type Edge = 'start' | 'end';
export function bounds(selection: Selection) {
  if (!selection) return null;
  return selection.anchor <= selection.end
    ? { start: selection.anchor, end: selection.end }
    : { start: selection.end, end: selection.anchor };
}
export function inRange(date: string, selection: Selection) {
  const range = bounds(selection);
  return !range || (date >= range.start && date <= range.end);
}
export function moveEdge(selection: NonNullable<Selection>, edge: Edge, date: string) {
  const range = bounds(selection);
  if (!range) return selection;
  const day =
    edge === 'start'
      ? date > range.end
        ? range.end
        : date
      : date < range.start
        ? range.start
        : date;
  return (edge === 'start') === selection.anchor <= selection.end
    ? { ...selection, anchor: day }
    : { ...selection, end: day };
}
export function selectionKey(
  selection: Selection,
  dates: string[],
  key: string,
  shift = false,
  edge?: Edge,
): Selection {
  if (key === 'Escape') return null;
  if (!selection || !dates.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key))
    return selection;
  if (!edge && (key === 'Home' || key === 'End')) return selection;
  const range = bounds(selection);
  if (!range) return selection;
  const current = edge ? range[edge] : selection.end;
  const index = dates.indexOf(current);
  const next =
    dates[Math.max(0, Math.min(dates.length - 1, index + (key === 'ArrowRight' ? 1 : -1)))];
  const day =
    key === 'Home'
      ? edge === 'start'
        ? dates[0]
        : range.start
      : key === 'End'
        ? edge === 'end'
          ? dates.at(-1)
          : range.end
        : next;
  if (!day) return selection;
  if (edge) return moveEdge(selection, edge, day);
  return shift ? { ...selection, end: day } : { anchor: day, end: day };
}
export type Period = '1M' | '3M' | '6M' | 'YTD';
export function visiblePrices(prices: Price[], period: Period) {
  const last = prices.at(-1);
  if (!last || period === 'YTD') return prices;
  const start = new Date(last.date + 'T00:00:00Z');
  start.setUTCMonth(start.getUTCMonth() - parseInt(period));
  return prices.filter((p) => p.date >= start.toISOString().slice(0, 10));
}
export type RowWindow = { first: number; last: number };
const RIGHT_PADDING = 3;
export function periodRange(prices: Price[], period: Period) {
  const first = prices.length - visiblePrices(prices, period).length;
  return { from: first - 0.5, to: prices.length - 1 + RIGHT_PADDING };
}
export function visibleWindow(
  length: number,
  range: { from: number; to: number } | null,
): RowWindow | null {
  if (!range) return null;
  const first = Math.max(0, Math.ceil(range.from)),
    last = Math.min(length - 1, Math.floor(range.to));
  return first <= last ? { first, last } : null;
}
export function selectedRows(dates: string[], selection: Selection): RowWindow | null {
  const b = bounds(selection);
  if (!b) return null;
  const first = dates.findIndex((d) => d >= b.start);
  const last = dates.filter((d) => d <= b.end).length - 1;
  return first >= 0 && first <= last ? { first, last } : null;
}
export function aggregateRange(prices: Price[], selection: Selection) {
  const rows = prices.filter((p) => inRange(p.date, selection));
  const first = rows[0],
    last = rows.at(-1);
  if (!first || !last) return null;
  const prior = prices[prices.indexOf(first) - 1];
  const change = prior ? last.close - prior.close : null;
  return {
    rows,
    prior,
    close: last.close,
    change,
    changePct: prior && prior.close ? (last.close / prior.close - 1) * 100 : null,
    high: Math.max(...rows.map((p) => p.close)),
    low: Math.min(...rows.map((p) => p.close)),
    volume: rows.reduce((sum, p) => sum + p.volume, 0),
    value: rows.reduce((sum, p) => sum + p.value, 0),
    netForeign: rows.reduce((sum, p) => sum + p.net_foreign, 0),
    suspended: rows.filter((p) => p.volume === 0).length,
  };
}
export function attachments(filing: Filing) {
  const lamp = (name: string) => Number(name.match(/_lamp(\d+)/i)?.[1] ?? Infinity);
  return filing.attachments
    .filter((a) => a.url !== filing.url)
    .sort((a, b) => lamp(a.name) - lamp(b.name))
    .map((a, i) => ({
      ...a,
      label: a.label ?? `Lampiran ${Number.isFinite(lamp(a.name)) ? lamp(a.name) : i + 1}`,
    }));
}
export function holderLabel(name: string) {
  return name
    .replace(/^PT[. ]*/i, '')
    .replace(/\b(PTE[.]?|LTD[.]?|TBK|LIMITED)\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '');
}
export type HoldingEvent = {
  holder_key: string;
  date: string;
  name: string;
  shares_before: number | null;
  shares_after: number | null;
  sources: string[];
};
export function ownershipEvents(data: Ticker): HoldingEvent[] {
  const events: HoldingEvent[] = [];
  const changes = data.changes.filter(
    (e) =>
      !(
        e.shares_after === null &&
        data.holders.some((h) => h.holder_key === e.holder_key && h.shares === e.shares_before)
      ),
  );
  for (const e of [
    ...changes.map((e) => ({ ...e, name: e.investor, url: null })),
    ...data.insiders.filter((e) => e.reporter).map((e) => ({ ...e, name: e.reporter ?? '' })),
  ]) {
    const url =
      e.url ??
      data.insiders.find((i) => i.date === e.date && i.reporter && i.holder_key === e.holder_key)
        ?.url;
    const old = events.find((v) => v.date === e.date && v.holder_key === e.holder_key);
    if (old) {
      old.shares_before = e.shares_before;
      old.shares_after = e.shares_after;
      if (url && !old.sources.includes(url)) old.sources.push(url);
    } else
      events.push({
        date: e.date,
        name: e.name,
        holder_key: e.holder_key ?? '',
        shares_before: e.shares_before,
        shares_after: e.shares_after,
        sources: url ? [url] : [],
      });
  }
  return events.sort((a, b) => b.date.localeCompare(a.date));
}
export function registryAt(data: Ticker, date: string) {
  return [...data.registry_history]
    .filter((s) => s.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}
export function holderRole(
  snapshot: Ticker['registry_history'][number] | undefined,
  holderKey: string,
) {
  const holder = snapshot?.holders.find((h) => h.holder_key === holderKey);
  return holder?.controller
    ? 'Controller'
    : holder?.controller_affiliate
      ? 'Controller affiliate'
      : null;
}
export function totalAt(data: Ticker, date: string) {
  return registryAt(data, date)?.issued_shares ?? null;
}
export type HoldingPoint = {
  date: string;
  shares: number | null;
  rounded?: boolean;
  pct?: number;
  priority: number;
  event?: boolean;
};
export type HoldingSeries = {
  holder_key: string;
  name: string;
  points: HoldingPoint[];
  events: HoldingEvent[];
};
export function holdingSeries(
  data: Ticker,
  dailyDate: string | null,
  events = ownershipEvents(data),
) {
  const series: HoldingSeries[] = [];
  const snapshots = [...data.registry_history].sort((a, b) => a.date.localeCompare(b.date));
  function get(holder_key: string, name: string) {
    let s = series.find((s) => s.holder_key === holder_key);
    if (!s) {
      s = { holder_key, name, points: [], events: [] };
      series.push(s);
    }
    return s;
  }
  for (const snap of snapshots)
    for (const h of snap.holders) {
      if (snap.issued_shares)
        get(h.holder_key, h.investor).points.push({
          date: snap.date,
          shares: (h.pct / 100) * snap.issued_shares,
          rounded: true,
          priority: 0,
        });
    }
  const monthly = [...data.one_pct_history];
  if (data.one_pct.date && !monthly.some((m) => m.date === data.one_pct.date))
    monthly.push({ date: data.one_pct.date, holders: data.one_pct.holders });
  monthly.sort((a, b) => a.date.localeCompare(b.date));
  for (const snap of monthly) {
    const accounts = new Map<
      string,
      { holder_key: string; investor: string; shares: number; pct: number }
    >();
    for (const h of snap.holders) {
      const combined = accounts.get(h.holder_key);
      accounts.set(h.holder_key, {
        holder_key: h.holder_key,
        investor: h.investor,
        shares: (combined?.shares ?? 0) + h.shares,
        pct: (combined?.pct ?? 0) + h.pct,
      });
    }
    for (const h of accounts.values()) {
      const s = get(h.holder_key, h.investor);
      s.points = s.points.filter((p) => p.date.slice(0, 7) !== snap.date.slice(0, 7));
      s.points.push({ date: snap.date, shares: h.shares, pct: h.pct, priority: 4 });
    }
  }
  for (const e of events) get(e.holder_key, e.name).events.push(e);
  if (dailyDate)
    for (const h of data.holders) {
      const s = get(h.holder_key, h.investor);
      if (!s.points.length)
        s.points.push({ date: dailyDate, shares: h.shares, pct: h.pct, priority: 5 });
    }
  for (const s of series) {
    const exacts = [
      ...s.events.flatMap((e) => [e.shares_before, e.shares_after]),
      ...s.points.filter((p) => !p.rounded).map((p) => p.shares),
    ].filter((v): v is number => v !== null);
    for (const p of s.points.filter((p) => p.rounded)) {
      const shares = p.shares;
      if (shares === null) continue;
      const total = totalAt(data, p.date);
      const nearest = exacts
        .filter((v) => total && Math.abs(v - shares) <= total * 0.00005 + 1)
        .sort((a, b) => Math.abs(a - shares) - Math.abs(b - shares))[0];
      if (nearest !== undefined) p.shares = nearest;
    }
    for (const [i, snap] of monthly.entries()) {
      const next = monthly[i + 1];
      if (
        next &&
        snap.holders.some((h) => h.holder_key === s.holder_key) &&
        !next.holders.some((h) => h.holder_key === s.holder_key)
      ) {
        const end = new Date(snap.date);
        end.setUTCDate(end.getUTCDate() + 1);
        s.points.push({ date: end.toISOString().slice(0, 10), shares: null, priority: -1 });
      }
    }
    s.points.sort((a, b) => a.date.localeCompare(b.date) || a.priority - b.priority);
    s.points = s.points.filter((p, i, all) => all[i + 1]?.date !== p.date);
    for (const e of [...s.events].sort((a, b) => a.date.localeCompare(b.date))) {
      const current = s.points.filter((p) => p.date < e.date).at(-1);
      if (
        current?.shares != null &&
        e.shares_before !== null &&
        e.shares_after !== null &&
        Math.abs(e.shares_before - current.shares) <= (totalAt(data, e.date) ?? 0) * 0.00005 + 1
      ) {
        const anchor = s.points.find((p) => p.date === e.date);
        if (anchor) {
          anchor.event = anchor.shares === e.shares_after;
          continue;
        }
        s.points.push({ date: e.date, shares: e.shares_after, priority: 3, event: true });
        s.points.sort((a, b) => a.date.localeCompare(b.date) || a.priority - b.priority);
        s.points = s.points.filter((p, i, all) => all[i + 1]?.date !== p.date);
      }
    }
    const latest = [...data.holders, ...data.one_pct.holders].find(
      (h) => h.holder_key === s.holder_key,
    );
    if (latest) s.name = latest.investor;
  }
  return series
    .filter((s) => s.events.length > 0 || s.points.some((p) => p.shares !== null && p.shares > 0))
    .sort((a, b) => (b.points.at(-1)?.shares ?? 0) - (a.points.at(-1)?.shares ?? 0));
}
export function sharesAt(series: HoldingSeries, date: string) {
  return series.points.filter((p) => p.date <= date).at(-1)?.shares;
}
export function pctAt(data: Ticker, series: HoldingSeries, date: string) {
  const point = series.points.filter((p) => p.date <= date).at(-1);
  const total = totalAt(data, date);
  return point?.shares == null ? null : total ? (point.shares / total) * 100 : (point.pct ?? null);
}
export function composition(data: Ticker, series: HoldingSeries[], date: string) {
  if (!totalAt(data, date) && !series.some((s) => pctAt(data, s, date) !== null)) return [];
  const parts = series
    .map((s) => ({ name: s.name, pct: pctAt(data, s, date) ?? 0, note: '' }))
    .filter((h) => h.pct >= 5)
    .sort((a, b) => b.pct - a.pct);
  const rest = Math.max(0, 100 - parts.reduce((sum, h) => sum + h.pct, 0));
  const snapshot = registryAt(data, date);
  const free = Math.min(snapshot?.free_float_pct ?? 0, rest);
  if (snapshot?.free_float_pct !== null && snapshot?.free_float_pct !== undefined)
    parts.push({ name: 'Free float', pct: free, note: `${snapshot.date} registry` });
  parts.push({ name: 'Other', pct: rest - free, note: '' });
  return parts;
}
export function isOwnershipFiling(filing: Filing, events: HoldingEvent[]) {
  return (
    /^LAPORAN KEPEMILIKAN/i.test(filing.title) &&
    events.some((e) => e.date === filing.published_at.slice(0, 10))
  );
}
export function summaryEvents(events: HoldingEvent[], filings: Filing[], selection: Selection) {
  const rows = [
    ...events
      .filter((e) => inRange(e.date, selection))
      .map((event) => ({ kind: 'ownership' as const, date: event.date, time: event.date, event })),
    ...filings
      .filter(
        (e) => inRange(e.published_at.slice(0, 10), selection) && !isOwnershipFiling(e, events),
      )
      .map((filing) => ({
        kind: 'filing' as const,
        date: filing.published_at.slice(0, 10),
        time: filing.published_at,
        filing,
      })),
  ];
  return rows.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      Number(b.kind === 'ownership') - Number(a.kind === 'ownership') ||
      b.time.localeCompare(a.time),
  );
}

export type NewsItem = { title: string; url: string; published_at: string; source: string };
export type TimelineItem = {
  at: string;
  kind: 'filing' | 'news';
  title: string;
  url: string;
  source?: string;
  attachments: { url: string; label: string }[];
};
export const TIMELINE_SHOWN = 5;
export function timeline(filings: Filing[], news: NewsItem[]): TimelineItem[] {
  return [
    ...filings.map((f) => ({
      at: f.published_at,
      kind: 'filing' as const,
      title: f.title,
      url: f.url,
      attachments: attachments(f).map(({ url, label }) => ({ url, label })),
    })),
    ...news.map((n) => ({
      at: n.published_at,
      kind: 'news' as const,
      title: n.title,
      url: n.url,
      source: n.source,
      attachments: [],
    })),
  ].sort((a, b) => publishedMs(b.at) - publishedMs(a.at));
}

export function cumulativeForeign(rows: Price[]) {
  let sum = 0;
  return rows.map((p) => (sum += p.net_foreign));
}

export const TOP_HOLDERS = 5;
export function topSeries(series: HoldingSeries[], date: string, count = TOP_HOLDERS) {
  return series
    .map((s) => ({ s, shares: sharesAt(s, date) }))
    .filter((h): h is { s: HoldingSeries; shares: number } => typeof h.shares === 'number')
    .filter((h) => h.shares > 0)
    .sort((a, b) => b.shares - a.shares)
    .slice(0, count)
    .map((h) => h.s);
}

// A log scale keeps a 1% holder readable next to a 55% controller.
const pctTicks = [0.5, 1, 2, 5, 10, 20, 50, 100];
export function pctAxis(values: number[]) {
  const positive = values.filter((v) => v > 0);
  const floor = positive.length
    ? ([...pctTicks].reverse().find((t) => t <= Math.min(...positive)) ?? pctTicks[0] ?? 0.5)
    : 1;
  const ceiling = Math.max(floor * 2, ...positive) * 1.15;
  return {
    floor,
    ceiling,
    ticks: pctTicks.filter((t) => t >= floor && t <= ceiling),
    position: (pct: number) => Math.log(Math.max(pct, floor) / floor) / Math.log(ceiling / floor),
  };
}

export type ActionChip = { label: string; date: string; title: string };
type CorporateAction = z.infer<typeof corporateActionSchema>;
type ActionStep = CorporateAction['steps'][number]['step'];
const stepNames: Record<ActionStep, string> = {
  cum: 'Cum date',
  ex: 'Ex date',
  record: 'Record date',
  pay: 'Payment',
  distribution: 'Distribution',
  listing: 'Listing',
  trade_start: 'Trading starts',
  trade_end: 'Trading ends',
  meeting: 'RUPS',
  delisting: 'Delisting',
};
const headline: Record<CorporateAction['kind'], { step: ActionStep; label: string }> = {
  DIV: { step: 'ex', label: 'Ex-div' },
  RIGHTS: { step: 'ex', label: 'Ex-rights' },
  BONUS: { step: 'ex', label: 'Ex-bonus' },
  SPLIT: { step: 'ex', label: 'Ex-split' },
  RUPS: { step: 'meeting', label: 'RUPS' },
  IPO: { step: 'listing', label: 'Listing' },
  DELIST: { step: 'delisting', label: 'Delisting' },
};
export function nextAction(
  actions: CorporateAction[],
  ticker: string,
  today: string,
  days = 30,
): ActionChip | null {
  const limit = new Date(today + 'T00:00:00Z');
  limit.setUTCDate(limit.getUTCDate() + days);
  const last = limit.toISOString().slice(0, 10);
  const upcoming = actions
    .filter((a) => a.ticker === ticker)
    .flatMap((action) => {
      const key = headline[action.kind];
      const step = action.steps.find((s) => s.step === key.step);
      const date = step?.date.slice(0, 10);
      return date && date >= today && date <= last ? [{ action, key, date }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const next = upcoming[0];
  if (!next) return null;
  const { action, key, date } = next;
  const amount = action.amount ? ` ${action.amount.currency} ${action.amount.value}` : '';
  return {
    label: `${key.label} ${dateText(date, false)}`,
    date,
    title: [
      `${action.label}${amount}`,
      ...action.steps.map((s) => `${stepNames[s.step]} ${dateText(s.date)}`),
    ].join('\n'),
  };
}
