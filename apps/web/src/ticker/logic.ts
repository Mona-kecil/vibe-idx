import type { Ticker } from '../data';

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
export function totalAt(data: Ticker, date: string) {
  const registry = registryAt(data, date);
  const monthly = [...data.one_pct_history];
  if (data.one_pct.date) monthly.push({ date: data.one_pct.date, holders: data.one_pct.holders });
  const latest = monthly
    .filter((s) => s.date <= date && (!registry || s.date.slice(0, 7) > registry.date.slice(0, 7)))
    .sort((a, b) => b.date.localeCompare(a.date))
    .find((s) => s.holders.some((h) => h.shares > 0 && h.pct > 0));
  const largest = latest?.holders
    .filter((h) => h.shares > 0 && h.pct > 0)
    .sort((a, b) => b.shares - a.shares)[0];
  return largest ? (largest.shares * 100) / largest.pct : (registry?.issued_shares ?? null);
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
      const name = h.holder_key;
      const combined = accounts.get(name);
      accounts.set(name, {
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
