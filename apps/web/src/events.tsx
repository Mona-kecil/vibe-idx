import type { Feed } from './data';
import { calendarDate, dateText, direction, itemDate, nf } from './ticker/format';

export type Event = Feed[number];
export type Lens = Event['kind'];
type Ownership = Extract<Event, { kind: 'five_pct_change' }>;

export const lenses: { kind: Lens; tag: string; label: string }[] = [
  { kind: 'ara', tag: 'ARA', label: 'Auto-rejection upper limit' },
  { kind: 'volume_spike', tag: 'Volume', label: 'Volume spike' },
  { kind: 'foreign_streak', tag: 'Foreign', label: 'Foreign buying streak' },
  { kind: 'green_on_red', tag: 'Green on red', label: 'Up while IHSG fell' },
  { kind: 'five_pct_change', tag: '5%', label: '5% ownership change' },
];
const order = Object.fromEntries(lenses.map((lens, i) => [lens.kind, i])) as Record<Lens, number>;
export const lensOf = (kind: Lens) => lenses[order[kind]]!;
export const parseLens = (value: string | null) =>
  lenses.find((lens) => lens.kind === value)?.kind ?? null;

export const short = (n: number) => {
  const a = Math.abs(n);
  return a >= 1e12
    ? nf(a / 1e12, 2) + 'T'
    : a >= 1e9
      ? nf(a / 1e9, 2) + 'B'
      : a >= 1e6
        ? nf(a / 1e6, 2) + 'M'
        : a >= 1e3
          ? nf(a / 1e3, 2) + 'K'
          : nf(a);
};
export const signed = (n: number, format = short) =>
  (n > 0 ? '+' : n < 0 ? '−' : '') + format(Math.abs(n));
export const pct = (n: number | null) => (n === null ? '—' : signed(n, (v) => nf(v, 2)) + '%');
export const date = (d: string | null) => (d ? dateText(d) : 'Not reported');

export const isExit = (row: Ownership) =>
  row.numbers.exited === true ||
  (row.numbers.pct_after === null && row.numbers.net_shares === null);
const move = (row: Ownership) =>
  isExit(row)
    ? row.numbers.pct_before - 5
    : row.numbers.pct_after === null
      ? -1
      : Math.abs(row.numbers.pct_after - row.numbers.pct_before);

export function strength(event: Event) {
  switch (event.kind) {
    case 'volume_spike':
      return event.numbers.multiple;
    case 'foreign_streak':
      return event.numbers.streak_days + event.numbers.net_foreign / 1e15;
    case 'ara':
    case 'green_on_red':
      return event.numbers.change_pct;
    case 'five_pct_change':
      return move(event);
  }
}

const holderKey = (investor: string) =>
  investor
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !['pt', 'tbk'].includes(t))
    .join(' ');

/**
 * The day's events, grouped by kind then strongest first. Ownership keeps the newest filing date,
 * one row per holder alias, and drops filings whose rounded holding did not move.
 */
export function briefing(feed: Feed, listed: (ticker: string) => boolean) {
  const ownershipDate = feed
    .filter((e) => e.kind === 'five_pct_change')
    .map((e) => e.date)
    .sort()
    .at(-1);
  const seen = new Set<string>();
  return feed
    .filter((event) => {
      if (!listed(event.ticker)) return false;
      if (event.kind !== 'five_pct_change') return true;
      const n = event.numbers,
        key = event.ticker + ' ' + holderKey(n.investor);
      if (event.date !== ownershipDate || seen.has(key)) return false;
      seen.add(key);
      return n.pct_after === null || nf(n.pct_before, 2) !== nf(n.pct_after, 2);
    })
    .sort(
      (a, b) =>
        order[a.kind] - order[b.kind] ||
        strength(b) - strength(a) ||
        a.ticker.localeCompare(b.ticker),
    );
}

export type SignalTile = { kind: Lens; count: number; top: Event[] };

/** One tile per kind with events, from `briefing()` order: distinct stocks, strongest first. */
export function signalTiles(events: Event[], size = 3): SignalTile[] {
  return lenses.flatMap(({ kind }) => {
    const seen = new Set<string>(),
      stocks: Event[] = [];
    for (const event of events) {
      if (event.kind !== kind || seen.has(event.ticker)) continue;
      seen.add(event.ticker);
      stocks.push(event);
    }
    return stocks.length ? [{ kind, count: stocks.length, top: stocks.slice(0, size) }] : [];
  });
}

export function magnitude(event: Event, leader: Event) {
  const top = strength(leader);
  return top > 0 ? Math.min(1, Math.max(0, strength(event)) / top) : 0;
}

export function tone(event: Event) {
  switch (event.kind) {
    case 'volume_spike':
      return '';
    case 'ara':
    case 'green_on_red':
      return direction(event.numbers.change_pct);
    case 'foreign_streak':
      return direction(event.numbers.net_foreign);
    case 'five_pct_change': {
      const n = event.numbers;
      return isExit(event)
        ? 'down'
        : direction(n.pct_after === null ? null : n.pct_after - n.pct_before);
    }
  }
}

type CalendarRow = {
  ts: string;
  c: string;
  imp: number;
  ev: string;
  by: string;
  dateOnly: boolean;
};
type ActionRow = {
  ticker: string;
  kind: string;
  label: string;
  steps: { step: string; date: string }[];
};
export type WeekItem =
  | {
      type: 'event';
      date: string;
      ts: string;
      country: string;
      title: string;
      source: string;
      timed: boolean;
    }
  | { type: 'action'; date: string; ticker: string; kind: string; label: string; pinned: boolean };

const weekDays = 7;
const exDated = new Set(['DIV', 'RIGHTS', 'BONUS', 'SPLIT']);

/**
 * High-impact calendar events and ex-dates or meetings in the next seven Jakarta days.
 * Pinned tickers come first, then date order, with unpinned shareholder meetings last.
 */
export function weekAhead(
  calendar: CalendarRow[],
  actions: ActionRow[],
  pins: string[],
  now: Date,
): WeekItem[] {
  const today = calendarDate(now.toISOString()),
    last = calendarDate(new Date(now.getTime() + (weekDays - 1) * 864e5).toISOString()),
    inWeek = (date: string) => date >= today && date <= last;
  const items: WeekItem[] = [
    ...calendar.flatMap((e): WeekItem[] => {
      const date = calendarDate(e.ts);
      if (e.imp !== 3 || !inWeek(date) || (!e.dateOnly && Date.parse(e.ts) < now.getTime()))
        return [];
      return [
        {
          type: 'event',
          date,
          ts: e.ts,
          country: e.c,
          title: e.ev,
          source: e.by,
          timed: !e.dateOnly,
        },
      ];
    }),
    ...actions.flatMap((a): WeekItem[] => {
      const wanted = a.kind === 'RUPS' ? 'meeting' : exDated.has(a.kind) ? 'ex' : null,
        step = a.steps.find((s) => s.step === wanted);
      if (!step || !inWeek(itemDate(step.date))) return [];
      return [
        {
          type: 'action',
          date: itemDate(step.date),
          ticker: a.ticker,
          kind: a.kind,
          label: a.label,
          pinned: pins.includes(a.ticker),
        },
      ];
    }),
  ];
  const rank = (i: WeekItem) =>
    i.type === 'action' ? (i.pinned ? 0 : i.kind === 'RUPS' ? 2 : 1) : 1;
  const within = (i: WeekItem) => (i.type === 'event' ? i.ts : i.ticker);
  return items.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.date.localeCompare(b.date) ||
      Number(a.type === 'action') - Number(b.type === 'action') ||
      within(a).localeCompare(within(b)),
  );
}

export function byTicker(events: Event[]) {
  const map = new Map<string, Event[]>();
  for (const event of events) map.set(event.ticker, [...(map.get(event.ticker) ?? []), event]);
  return map;
}

export function EventText({ event }: { event: Event }) {
  switch (event.kind) {
    case 'ara':
      return (
        <>
          <b className={direction(event.numbers.change_pct)}>
            {signed(event.numbers.change_pct, (v) => nf(v, 1))}%
          </b>{' '}
          ARA
        </>
      );
    case 'volume_spike':
      return (
        <>
          <b>{nf(event.numbers.multiple, 1)}×</b> volume vs {event.numbers.prior_days}-day avg
        </>
      );
    case 'green_on_red':
      return (
        <>
          <b className={direction(event.numbers.change_pct)}>{pct(event.numbers.change_pct)}</b> vs
          market{' '}
          <b className={direction(event.numbers.market_change_pct)}>
            {pct(event.numbers.market_change_pct)}
          </b>
        </>
      );
    case 'foreign_streak':
      return (
        <>
          <b>{event.numbers.streak_days}-day</b> foreign streak{' '}
          <b className={direction(event.numbers.net_foreign)}>
            {signed(event.numbers.net_foreign)} IDR
          </b>
        </>
      );
    case 'five_pct_change': {
      const n = event.numbers,
        exit = isExit(event);
      return (
        <>
          <span className="holder">{n.investor}</span>{' '}
          <b
            className={
              exit ? 'exit' : n.net_shares === null ? 'unreported' : direction(n.net_shares)
            }
          >
            {exit ? 'Exit' : n.net_shares === null ? 'Not reported' : signed(n.net_shares)}
          </b>{' '}
          <span className="transition">
            {nf(n.pct_before, 2)} →{' '}
            {exit ? '<5%' : n.pct_after === null ? '—' : nf(n.pct_after, 2) + '%'}
          </span>
        </>
      );
    }
  }
}

/** The single number a briefing row shows for an event. */
export function EventMetric({ event }: { event: Event }) {
  switch (event.kind) {
    case 'ara':
    case 'green_on_red':
      return <b className={direction(event.numbers.change_pct)}>{pct(event.numbers.change_pct)}</b>;
    case 'volume_spike':
      return <b>{nf(event.numbers.multiple, 1)}×</b>;
    case 'foreign_streak':
      return (
        <>
          <span>{event.numbers.streak_days}d</span>{' '}
          <b className={direction(event.numbers.net_foreign)}>
            {signed(event.numbers.net_foreign)}
          </b>
        </>
      );
    case 'five_pct_change': {
      const n = event.numbers;
      return isExit(event) ? (
        <b className="exit">{nf(n.pct_before, 2)} → &lt;5%</b>
      ) : (
        <b className={direction(n.pct_after === null ? null : n.pct_after - n.pct_before)}>
          {nf(n.pct_before, 2)} → {n.pct_after === null ? '—' : nf(n.pct_after, 2) + '%'}
        </b>
      );
    }
  }
}

export function eventTitle(event: Event) {
  const when = date(event.date);
  switch (event.kind) {
    case 'ara':
      return `${when}; previous close ${nf(event.numbers.prev)}; close ${nf(event.numbers.close)} IDR; ARA band ${event.numbers.band_pct}%`;
    case 'volume_spike':
      return `${when}; ${nf(event.numbers.volume)} shares vs ${nf(event.numbers.avg_volume)} average over ${event.numbers.prior_days} days; value ${nf(event.numbers.value)} IDR`;
    case 'green_on_red':
      return `${when}; stock ${pct(event.numbers.change_pct)}; market ${pct(event.numbers.market_change_pct)}; value ${nf(event.numbers.value)} IDR`;
    case 'foreign_streak':
      return `${when}; net foreign ${signed(event.numbers.net_foreign, nf)} IDR across ${event.numbers.streak_days} days`;
    case 'five_pct_change': {
      const n = event.numbers;
      return `${n.investor}; ${nf(n.shares_before)} → ${isExit(event) ? 'unknown' : n.shares_after === null ? 'not reported' : nf(n.shares_after)} shares; previous report ${date(n.previous_date)}`;
    }
  }
}
