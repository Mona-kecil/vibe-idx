import { useState, type MouseEvent, type ReactNode } from 'react';
import { EventText, eventTitle, type Event } from './events';
import { compact, pct } from './marketFormat';
import { RiskBadge } from './RiskBadge';
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
  events: Event[];
};

const pageSize = 50;
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
                  <RiskBadge risk={row.risk} />
                </div>
                {row.events.map((event, i) => (
                  <span key={i} className="rank-event" title={eventTitle(event)}>
                    <EventText event={event} />
                  </span>
                ))}
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
                {metric === 'net_foreign' ? (
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
