import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import { useAuth } from '@workos-inc/authkit-react';
import { AccountControls } from '../BrokerPanel';
import { aggregateBrokers, brokerName } from '../broker-data';
import { brokerHistorySchema, type BrokerDay } from '../brokers';
import { bounds, inRange, type Selection } from './logic';
import { dateText, nf, rangeText, short } from './format';

export function BrokerFlow({
  ticker,
  selection,
  start,
  end,
}: {
  ticker: string;
  selection: Selection;
  start: string;
  end: string;
}) {
  const { user, isLoading } = useAuth();
  const b = bounds(selection);
  return (
    <section className="section" id="broker-section" aria-labelledby="broker-heading">
      <div className="section-head">
        <h2 id="broker-heading">
          Broker flow
          {b && <span className="broker-heading-date">{rangeText(b.start, b.end, true)}</span>}
        </h2>
        {!b && (
          <span className="date-label">
            {dateText(start, false)} – {dateText(end)}
          </span>
        )}
      </div>
      {!user ? (
        <div className="signin">
          <AccountControls />
        </div>
      ) : isLoading ? (
        <p role="status">Loading data…</p>
      ) : (
        <BrokerData
          key={`${user.id}:${ticker}`}
          ticker={ticker}
          selection={selection}
          start={start}
          end={end}
        />
      )}
    </section>
  );
}
function BrokerData({
  ticker,
  selection,
  start,
  end,
}: {
  ticker: string;
  selection: Selection;
  start: string;
  end: string;
}) {
  const { getAccessToken } = useAuth();
  const [state, setState] = useState<
    | { kind: 'loading' | 'error' | 'unauthorized' | 'missing' }
    | { kind: 'ready'; days: BrokerDay[] }
  >({ kind: 'loading' });
  const [attempt, retry] = useState(0);
  const [mode, setMode] = useState<'net' | 'gross'>('net');
  const [showAll, setShowAll] = useState(false);
  const tip = useBrokerTip();
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    async function read() {
      const token = await getAccessToken();
      if (controller.signal.aborted) return;
      if (!token) {
        setState({ kind: 'unauthorized' });
        return;
      }
      const response = await fetch(`/api/brokers?ticker=${encodeURIComponent(ticker)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        setState({ kind: 'unauthorized' });
        return;
      }
      if (response.status === 404) {
        setState({ kind: 'missing' });
        return;
      }
      if (!response.ok) throw new Error('Broker request failed');
      const history = brokerHistorySchema.parse(await response.json());
      if (history.ticker !== ticker) throw new Error('Broker ticker mismatch');
      if (!controller.signal.aborted) setState({ kind: 'ready', days: history.days });
    }
    void read().catch(() => {
      if (!controller.signal.aborted) setState({ kind: 'error' });
    });
    return () => controller.abort();
  }, [ticker, getAccessToken, attempt]);
  if (state.kind === 'loading') return <p role="status">Loading data…</p>;
  if (state.kind === 'unauthorized') return <AccountControls />;
  if (state.kind === 'missing')
    return <p className="empty-state">Broker data is not available yet.</p>;
  if (state.kind === 'error')
    return (
      <p role="alert">
        Could not load broker data. <button onClick={() => retry(attempt + 1)}>Retry</button>
      </p>
    );
  if (state.kind !== 'ready') return null;
  const days = state.days.filter((d) =>
    selection ? inRange(d.date, selection) : d.date >= start && d.date <= end,
  );
  const rows = aggregateBrokers(days);
  if (!rows.length) return <p className="empty-state">No trades reported in this period</p>;
  const side = (type: 'buy' | 'sell') =>
    rows
      .map((b) => {
        const [value, shares, otherValue, otherShares] =
          type === 'buy'
            ? [b.buyValue, b.buy, b.sellValue, b.sell]
            : [b.sellValue, b.sell, b.buyValue, b.buy];
        return {
          code: b.code,
          amount: mode === 'net' ? value - otherValue : value,
          volume: mode === 'net' ? shares - otherShares : shares,
          avg: value / shares,
        };
      })
      .filter((b) => b.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  const buyers = side('buy'),
    sellers = side('sell'),
    edge = edgeFills(buyers, sellers),
    limit = showAll ? Infinity : 10;
  const ledger = (type: 'buy' | 'sell', list: typeof buyers) => (
    <table className={`broker-ledger ${type}`}>
      <thead>
        <tr>
          <th>{type === 'buy' ? 'Buyers' : 'Sellers'}</th>
          <th className="num">
            {mode === 'net' ? 'Net' : 'Value'} <small className="unit-suffix">IDR</small>
          </th>
          <th className="num">Vol</th>
          <th className="num">Avg</th>
        </tr>
      </thead>
      <tbody>
        {list.slice(0, limit).map((row) => (
          <tr key={row.code}>
            <td tabIndex={0} {...tip.bind(row.code)}>
              {row.code}
              <span className="sr-only"> {brokerName(row.code)}</span>
            </td>
            <td className={`num ${type === 'buy' ? 'up' : 'down'}`} title={`${nf(row.amount)} IDR`}>
              {short(row.amount)}
            </td>
            <td className="num" title={`${nf(row.volume)} shares`}>
              {short(row.volume)}
            </td>
            <td className={`num${edge.has(row) ? ' edge' : ''}`} title={`${nf(row.avg, 2)} IDR`}>
              {nf(row.avg, 1)}
              {edge.has(row) && (
                <span className="sr-only">
                  {type === 'buy' ? ' near the period low' : ' near the period high'}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="broker-flow">
      <div className="broker-controls">
        <div className="ranges broker-unit" aria-label="Broker flow mode">
          {(['net', 'gross'] as const).map((m) => (
            <button key={m} aria-pressed={m === mode} onClick={() => setMode(m)}>
              {m === 'net' ? 'Net' : 'Gross'}
            </button>
          ))}
        </div>
        {Math.max(buyers.length, sellers.length) > 10 && (
          <button className="broker-more" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show top 10' : 'Show all'}
          </button>
        )}
      </div>
      <div className="broker-ledgers" ref={tip.box}>
        {ledger('buy', buyers)}
        {ledger('sell', sellers)}
        {tip.open && (
          <div
            className="broker-tip"
            aria-hidden="true"
            data-instant={tip.open.instant || undefined}
            style={{ left: tip.open.x, top: tip.open.y, maxWidth: tip.open.room }}
          >
            {brokerName(tip.open.code)}
          </div>
        )}
      </div>
    </div>
  );
}

type Fill = { avg: number; volume: number };
// Weighting by volume keeps a 1-lot trade at an odd price from stretching the range.
export function edgeFills<T extends Fill>(buyers: T[], sellers: T[]) {
  const fills = [
    ...buyers.map((fill) => ({ fill, buy: true })),
    ...sellers.map((fill) => ({ fill, buy: false })),
  ].sort((a, b) => a.fill.avg - b.fill.avg);
  const total = fills.reduce((sum, { fill }) => sum + Math.max(fill.volume, 0), 0);
  let seen = 0;
  const kept = fills.filter(({ fill }) => {
    const weight = Math.max(fill.volume, 0),
      inside = weight > 0 && seen < 0.95 * total && seen + weight > 0.05 * total;
    seen += weight;
    return inside;
  });
  const low = kept[0]?.fill.avg ?? 0,
    band = ((kept.at(-1)?.fill.avg ?? 0) - low) * 0.25;
  if (!(band > 0)) return new Set<T>();
  return new Set(
    kept
      .filter(({ fill, buy }) => (buy ? fill.avg <= low + band : fill.avg >= low + 3 * band))
      .map(({ fill }) => fill),
  );
}

function useBrokerTip() {
  const box = useRef<HTMLDivElement>(null),
    timer = useRef(0),
    closedAt = useRef(0),
    touch = useRef(false);
  const [open, setOpen] = useState<{
    code: string;
    x: number;
    y: number;
    room: number;
    instant: boolean;
  } | null>(null);
  const shown = open !== null;
  useEffect(() => {
    if (!shown) return;
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [shown]);
  useEffect(() => () => clearTimeout(timer.current), []);
  function show(code: string, cell: HTMLElement, instant: boolean) {
    const outer = box.current?.getBoundingClientRect();
    if (!outer) return;
    const rect = cell.getBoundingClientRect(),
      x = rect.left - outer.left;
    setOpen({ code, x, y: rect.top - outer.top, room: outer.width - x, instant });
  }
  function hide() {
    clearTimeout(timer.current);
    setOpen((current) => {
      if (current) closedAt.current = performance.now();
      return null;
    });
  }
  function later(code: string, cell: HTMLElement, delay: number) {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => show(code, cell, false), delay);
  }
  const bind = (code: string) => ({
    onPointerEnter(e: PointerEvent<HTMLElement>) {
      if (e.pointerType !== 'mouse') return;
      if (shown || performance.now() - closedAt.current < 300) {
        clearTimeout(timer.current);
        show(code, e.currentTarget, true);
      } else later(code, e.currentTarget, 400);
    },
    onPointerDown(e: PointerEvent<HTMLElement>) {
      touch.current = e.pointerType !== 'mouse';
      if (touch.current) later(code, e.currentTarget, 350);
    },
    onPointerLeave: hide,
    onPointerUp(e: PointerEvent<HTMLElement>) {
      if (e.pointerType !== 'mouse') hide();
    },
    onPointerCancel: hide,
    onContextMenu(e: { preventDefault(): void }) {
      if (touch.current) e.preventDefault();
    },
    onFocus(e: FocusEvent<HTMLElement>) {
      if (e.currentTarget.matches(':focus-visible')) show(code, e.currentTarget, shown);
    },
    onBlur: hide,
  });
  return { box, open, bind };
}
