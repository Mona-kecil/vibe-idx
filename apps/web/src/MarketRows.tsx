import { useState, type MouseEvent, type ReactNode } from 'react';
import { signalTitle, isExit, type Signal } from './signals';
import { compact, pct } from './marketFormat';
import { RiskFlagChips } from './RiskFlagChips';
import type { Risk } from './terminal/sources';
import { direction, nf, signed } from './ticker/format';

export const openOnRowClick = (ticker: string) => (event: MouseEvent) => {
  if (
    event.target instanceof Element &&
    !event.target.closest('a, button, details') &&
    !window.getSelection()?.toString()
  )
    window.location.assign(`/t/${ticker}`);
};

export type RankMetric = 'change_pct' | 'value' | 'net_foreign';
export type RankRow = {
  ticker: string;
  name: string;
  change: number | null;
  value: number | null;
  foreign: number | null;
  risk: Risk | undefined;
  events: Signal[];
};

const pageSize = 50;
type Ownership = Extract<Signal, { kind: 'five_pct_change' }>;
const signalSize = (event: Signal) =>
  event.kind === 'volume_spike'
    ? event.numbers.multiple
    : event.kind === 'foreign_streak'
      ? event.numbers.net_foreign
      : event.kind === 'five_pct_change'
        ? null
        : event.numbers.change_pct;

function Dumbbell({ event }: { event: Ownership }) {
  const n = event.numbers,
    exit = isExit(event),
    after = exit ? 5 : n.pct_after;
  const tone = exit ? 'down' : direction(after === null ? null : after - n.pct_before);
  const x = (pct: number) => `${Math.min(100, Math.max(0, pct))}%`;
  return (
    <svg className={`dumbbell ${tone}`} width="100%" height="14" aria-hidden="true">
      <line className="dumbbell-track" x1="0" x2="100%" y1="7" y2="7" />
      {after !== null && (
        <line className="dumbbell-move" x1={x(n.pct_before)} x2={x(after)} y1="7" y2="7" />
      )}
      <circle className="dumbbell-before" cx={x(n.pct_before)} cy="7" r="3.5" />
      {after !== null && (
        <circle
          className={exit ? 'dumbbell-exit' : 'dumbbell-after'}
          cx={x(after)}
          cy="7"
          r="4.5"
        />
      )}
    </svg>
  );
}

function SignalNumber({ event, row }: { event: Signal; row: RankRow }) {
  switch (event.kind) {
    case 'volume_spike':
      return <span>{nf(event.numbers.multiple, 1)}×</span>;
    case 'foreign_streak':
      return (
        <span className={direction(event.numbers.net_foreign)}>
          {event.numbers.streak_days}d {signed(event.numbers.net_foreign, compact)}
        </span>
      );
    case 'five_pct_change': {
      const n = event.numbers;
      return (
        <span>
          {nf(n.pct_before, 2)} →{' '}
          {isExit(event) ? '<5%' : n.pct_after === null ? '—' : `${nf(n.pct_after, 2)}%`}
        </span>
      );
    }
    default:
      return <span>{compact(row.value)}</span>;
  }
}
const metricOf = (row: RankRow, metric: RankMetric | null) =>
  metric === 'change_pct'
    ? row.change
    : metric === 'value'
      ? row.value
      : metric
        ? row.foreign
        : null;

export function MarketRows({
  rows,
  metric,
  pin,
}: {
  rows: RankRow[];
  metric: RankMetric | null;
  pin: (ticker: string) => ReactNode;
}) {
  const [limit, setLimit] = useState(pageSize);
  const visible = rows.slice(0, limit);
  const max = Math.max(0, ...visible.map((row) => Math.abs(metricOf(row, metric) ?? 0)));
  const signalMax = Math.max(
    0,
    ...visible.flatMap((row) => row.events.map((e) => Math.abs(signalSize(e) ?? 0))),
  );
  const remaining = rows.length - visible.length;
  return (
    <>
      <ol id="market-rows" className="rank-rows" aria-label="Market stocks">
        {visible.map((row) => {
          const measure = metricOf(row, metric);
          const width = measure ? Math.max(1, (Math.abs(measure) / max) * 100) : 0;
          const tone = metric === 'value' ? '' : direction(measure);
          return (
            <li key={row.ticker} onClick={openOnRowClick(row.ticker)}>
              <div className="rank-main">
                <div className="rank-id">
                  <a className="stock-link" href={`/t/${row.ticker}`}>
                    <strong>{row.ticker}</strong>
                    <span className="company" title={row.name}>
                      {row.name}
                    </span>
                  </a>
                  <RiskFlagChips risk={row.risk} />
                </div>
                {row.events.map((event, i) => {
                  const size = signalSize(event);
                  return (
                    <span key={i} className="rank-signal" title={signalTitle(event)}>
                      {event.kind === 'five_pct_change' ? (
                        <Dumbbell event={event} />
                      ) : (
                        <span className="rank-track" aria-hidden="true">
                          <span
                            className={`rank-bar ${event.kind === 'volume_spike' ? '' : direction(size)}`}
                            style={{
                              width: `${size && signalMax ? Math.max(1, (Math.abs(size) / signalMax) * 100) : 0}%`,
                            }}
                          />
                        </span>
                      )}
                    </span>
                  );
                })}
                {metric && (
                  <span className="rank-track" aria-hidden="true">
                    <span className={`rank-bar ${tone}`} style={{ width: `${width}%` }} />
                  </span>
                )}
              </div>
              <div className="rank-nums">
                <b
                  className={direction(row.change)}
                  title={row.change === null ? 'Price data is missing' : `${row.change}%`}
                >
                  {pct(row.change)}
                </b>
                {row.events[0] ? (
                  <SignalNumber event={row.events[0]} row={row} />
                ) : metric === 'net_foreign' ? (
                  <span
                    className={direction(row.foreign)}
                    title={
                      row.foreign === null ? 'Foreign data is missing' : `${nf(row.foreign)} IDR`
                    }
                  >
                    {row.foreign === null ? '—' : signed(row.foreign, compact)}
                  </span>
                ) : (
                  <span
                    title={row.value === null ? 'Traded value is missing' : `${nf(row.value)} IDR`}
                  >
                    {compact(row.value)}
                  </span>
                )}
              </div>
              {pin(row.ticker)}
            </li>
          );
        })}
      </ol>
      {remaining > 0 && (
        <button type="button" className="show-more" onClick={() => setLimit(limit + pageSize)}>
          Show {Math.min(pageSize, remaining)} more
        </button>
      )}
    </>
  );
}
