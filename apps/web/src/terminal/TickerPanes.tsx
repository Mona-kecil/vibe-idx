import { useEffect, useRef, useState } from 'react';
import { useTerminal } from './state';
import { Availability, Empty, Scroll, direction } from './ui';
import type { Ticker } from '../data';
import { PinButton } from './MarketPanes';
import { dateText, nf, short, signed } from '../ticker/format';
import { bounds, holderRole, inRange, registryAt } from '../ticker/logic';
import { FilingAttachments } from '../ticker/Feeds';

export function DescriptionPane() {
  const { detail, ticker } = useTerminal();
  return (
    <Scroll reset={ticker}>
      <Availability resource={detail} name="Ticker history">
        {(data) => {
          const last = data.prices.at(-1),
            previous = data.prices.at(-2),
            registry = registryAt(data, last?.date ?? '');
          const fields = [
            ['LAST IDR', last ? nf(last.close) : '—'],
            [
              'CHANGE',
              last && previous
                ? `${signed(last.close - previous.close, nf)} (${nf((last.close / previous.close - 1) * 100, 2)}%)`
                : '—',
            ],
            ['PRICE DATE', last ? dateText(last.date) : '—'],
            ['VALUE IDR', last ? short(last.value) : '—'],
            ['VOLUME SHARES', last ? short(last.volume) : '—'],
            ['NET FOREIGN EST. IDR', last ? signed(last.net_foreign, short) : '—'],
            [
              'FREE FLOAT',
              registry?.free_float_pct == null ? '—' : `${nf(registry.free_float_pct, 2)}%`,
            ],
            ['SID COUNT', registry?.sid_count == null ? '—' : nf(registry.sid_count)],
            ['ISSUED SHARES', registry?.issued_shares == null ? '—' : nf(registry.issued_shares)],
            ['REGISTRY DATE', registry ? dateText(registry.date) : '—'],
          ];
          return (
            <div className="description">
              <div className="key-heading">
                <h1>{data.name}</h1>
                <PinButton ticker={ticker} showTicker />
              </div>
              <dl>
                {fields.map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        }}
      </Availability>
    </Scroll>
  );
}
type HolderPoint = { date: string; shares: number | null } & (
  | { pct: number }
  | { pct: null; below: 1 | 5 }
);
type HolderHistory = { key: string; name: string; points: HolderPoint[] };
function holderHistories(data: Ticker, date: string | null) {
  const histories = new Map<string, HolderHistory>();
  function add(key: string, name: string, point: HolderPoint) {
    const history = histories.get(key) ?? { key, name, points: [] };
    history.name = name;
    history.points = history.points.filter((p) => p.date !== point.date);
    history.points.push(point);
    histories.set(key, history);
  }
  for (const snapshot of [...data.registry_history].sort((a, b) => a.date.localeCompare(b.date)))
    for (const holder of snapshot.holders)
      if (holder.pct >= 1)
        add(holder.holder_key, holder.investor, {
          date: snapshot.date,
          pct: holder.pct,
          shares: null,
        });
  const monthly = data.one_pct_history.filter((s) => s.date !== data.one_pct.date);
  if (data.one_pct.date) monthly.push({ date: data.one_pct.date, holders: data.one_pct.holders });
  let previousAccounts: string[] = [];
  for (const snapshot of monthly.sort((a, b) => a.date.localeCompare(b.date))) {
    const accounts = new Map<string, Ticker['holders'][number]>();
    for (const holder of snapshot.holders) {
      const combined = accounts.get(holder.holder_key);
      accounts.set(holder.holder_key, {
        ...holder,
        pct: (combined?.pct ?? 0) + holder.pct,
        shares: (combined?.shares ?? 0) + holder.shares,
      });
    }
    for (const key of previousAccounts) {
      const history = histories.get(key);
      if (history && !accounts.has(key))
        add(key, history.name, { date: snapshot.date, pct: null, shares: null, below: 1 });
    }
    previousAccounts = [...accounts.keys()];
    for (const holder of accounts.values()) {
      const history = histories.get(holder.holder_key);
      // Monthly account totals supersede rounded registry percentages for that month.
      if (history)
        history.points = history.points.filter(
          (p) => p.date.slice(0, 7) !== snapshot.date.slice(0, 7),
        );
      add(holder.holder_key, holder.investor, {
        date: snapshot.date,
        pct: holder.pct,
        shares: holder.shares,
      });
    }
  }
  for (const row of [...data.changes].sort((a, b) => a.date.localeCompare(b.date)))
    add(row.holder_key, row.investor, {
      date: row.date,
      ...(row.pct_after === null ? { pct: null, below: 5 } : { pct: row.pct_after }),
      shares: row.shares_after,
    });
  if (date)
    for (const holder of data.holders)
      add(holder.holder_key, holder.investor, { date, pct: holder.pct, shares: holder.shares });
  return [...histories.values()].map((history) => ({
    ...history,
    points: history.points.sort((a, b) => a.date.localeCompare(b.date)),
  }));
}
const holderColors = ['#5ab9d4', '#d6b25e', '#b48cf2', '#e58e68', '#75bf85', '#df87b2'];
function holdingText(point: HolderPoint) {
  return point.pct === null ? `Below ${point.below}%` : `${nf(point.pct, 2)}%`;
}
function holdingChange(first: HolderPoint, last: HolderPoint) {
  if (first.pct !== null && last.pct !== null) {
    const value = last.pct - first.pct;
    return { text: `${signed(value, (v) => nf(v, 2))} pp`, value };
  }
  // A holding below the reporting threshold is unknown, so only a bound on the change is known.
  // Show it when it fixes the direction; otherwise even the direction is unknown.
  if (first.pct !== null && last.pct === null) {
    const bound = last.below - first.pct;
    return bound <= 0
      ? { text: `${signed(bound, (v) => nf(v, 2))} pp or more`, value: -1 }
      : { text: '—', value: null };
  }
  if (first.pct === null && last.pct !== null) {
    const bound = last.pct - first.below;
    return bound >= 0
      ? { text: `${signed(bound, (v) => nf(v, 2))} pp or more`, value: 1 }
      : { text: '—', value: null };
  }
  return { text: '—', value: null };
}
function HoldersChart({
  histories,
  snapshot,
}: {
  histories: HolderHistory[];
  snapshot: ReturnType<typeof registryAt>;
}) {
  const [shown, setShown] = useState(() =>
    histories.slice(0, 6).map((h, i) => ({ key: h.key, color: holderColors[i] ?? '#d9ded8' })),
  );
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const active = hover ?? focus;
  const shell = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(660);
  const [height, setHeight] = useState(256);
  useEffect(() => {
    const element = shell.current;
    const pane = element?.closest('.pb');
    if (!element || !pane || typeof ResizeObserver === 'undefined') return;
    // The holder list keeps its rows on screen; the chart takes what is left, between 160 and 256px.
    const fit = () => {
      setWidth(element.clientWidth);
      const rest = pane.scrollHeight - element.offsetHeight;
      setHeight(Math.round(Math.max(160, Math.min(256, pane.clientHeight - rest))));
    };
    const observer = new ResizeObserver(fit);
    fit();
    observer.observe(element);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);
  const dates = histories.flatMap((h) => h.points.map((p) => p.date)).sort();
  const firstDate = dates[0],
    lastDate = dates.at(-1);
  if (!firstDate || !lastDate) return null;
  const start = Date.parse(firstDate),
    span = Date.parse(lastDate) - start;
  const left = 46,
    right = width - 14,
    top = 14,
    bottom = height - 30;
  const values = histories.flatMap((h) => h.points.flatMap((p) => (p.pct === null ? [] : [p.pct])));
  // A log scale keeps a 1% holder readable next to a 55% controller.
  const ticks = [0.5, 1, 2, 5, 10, 20, 50, 100];
  const floor = [...ticks].reverse().find((tick) => tick <= Math.min(...values)) ?? 0.5;
  const ceiling = Math.max(floor * 2, ...values) * 1.15;
  const x = (date: string) =>
    span ? left + ((Date.parse(date) - start) / span) * (right - left) : (left + right) / 2;
  const y = (pct: number) =>
    bottom - (Math.log(Math.max(pct, floor) / floor) / Math.log(ceiling / floor)) * (bottom - top);
  const color = (key: string) => shown.find((line) => line.key === key)?.color ?? '#d9ded8';
  const plotted = histories.filter(
    (h) => shown.some((line) => line.key === h.key) || h.key === active,
  );
  // Draw the highlighted holder last so overlapping holdings remain inspectable.
  plotted.sort((a, b) => Number(a.key === active) - Number(b.key === active));
  return (
    <div className="holders">
      <div className="holders-chart" ref={shell}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ height }}
          role="img"
          aria-label={`Reported holdings in percent from ${dateText(firstDate)} to ${dateText(lastDate)}`}
        >
          {ticks
            .filter((tick) => tick >= floor && tick <= ceiling)
            .map((pct) => (
              <g key={pct} className="holder-axis">
                <line x1={left} x2={right} y1={y(pct)} y2={y(pct)} />
                <text x={left - 8} y={y(pct) + 3} textAnchor="end">
                  {nf(pct)}%
                </text>
              </g>
            ))}
          {[
            ...new Set([
              firstDate,
              ...(span > 180 * 86400000
                ? [new Date(start + span / 2).toISOString().slice(0, 10)]
                : []),
              lastDate,
            ]),
          ].map((date) => (
            <text
              key={date}
              className="holder-axis"
              x={x(date)}
              y={height - 8}
              textAnchor={
                !span
                  ? 'middle'
                  : date === firstDate
                    ? 'start'
                    : date === lastDate
                      ? 'end'
                      : 'middle'
              }
            >
              {dateText(date)}
            </text>
          ))}
          {plotted.map((history) => (
            <g
              key={history.key}
              data-holder={history.key}
              stroke={color(history.key)}
              fill={color(history.key)}
              opacity={active && active !== history.key ? 0.18 : 1}
            >
              <path
                fill="none"
                strokeWidth={active === history.key ? 2.5 : 1.5}
                d={history.points
                  .map((point, i, all) => {
                    if (point.pct === null) return '';
                    return `${i === 0 || all[i - 1]?.pct === null ? 'M' : 'L'}${x(point.date)},${y(point.pct)}`;
                  })
                  .join(' ')}
              />
              {history.points.map((point) =>
                point.pct === null ? null : (
                  <circle
                    key={point.date}
                    cx={x(point.date)}
                    cy={y(point.pct)}
                    r={active === history.key ? 3 : 2}
                  >
                    <title>
                      {history.name} {dateText(point.date)} {holdingText(point)}
                    </title>
                  </circle>
                ),
              )}
            </g>
          ))}
        </svg>
      </div>
      <div className="holder-entries">
        {histories.map((history) => {
          const first = history.points[0],
            last = history.points.at(-1);
          if (!first || !last) return null;
          const role = holderRole(snapshot, history.key);
          const change = holdingChange(first, last);
          const visible = shown.some((line) => line.key === history.key);
          return (
            <section
              key={history.key}
              className="holder-history"
              aria-label={history.name}
              data-active={active === history.key}
              onPointerEnter={() => setHover(history.key)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setFocus(history.key)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFocus(null);
              }}
            >
              <details>
                <summary
                  className="holder-title"
                  title={`Reported values from ${dateText(first.date)} to ${dateText(last.date)}`}
                >
                  <i
                    className="holder-swatch"
                    data-shown={visible}
                    style={{
                      color: color(history.key),
                      background:
                        visible || active === history.key ? color(history.key) : undefined,
                    }}
                  />
                  <span className="holder-name" title={history.name}>
                    {history.name}
                    {role && (
                      <span className="holder-role" aria-label={role} title={role}>
                        {role === 'Controller' ? 'CTRL' : 'AFFIL'}
                      </span>
                    )}
                  </span>
                  <b
                    title={`Reported ${dateText(last.date)}${last.shares === null ? '' : ` ${nf(last.shares)} shares`}`}
                  >
                    {holdingText(last)}
                  </b>
                  <span
                    className={`holder-change ${direction(change.value)}`}
                    title={`${change.text} from ${dateText(first.date)} to ${dateText(last.date)}${first.pct === null || last.pct === null ? '; exact change unknown because a holding is below the reporting threshold' : `; exact change ${signed(last.pct - first.pct, (v) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 10 }).format(v))} pp`}`}
                  >
                    {change.text}
                  </span>
                </summary>
                <div className="holder-reports">
                  <button
                    aria-pressed={visible}
                    onClick={() =>
                      setShown((current) => {
                        if (visible) return current.filter((line) => line.key !== history.key);
                        const kept = current.slice(-5);
                        const nextColor = holderColors.find(
                          (c) => !kept.some((line) => line.color === c),
                        );
                        return [...kept, { key: history.key, color: nextColor ?? '#d9ded8' }];
                      })
                    }
                  >
                    Show on chart
                  </button>
                  <table>
                    <thead>
                      <tr>
                        <th>DATE</th>
                        <th>HOLDING</th>
                        <th>SHARES</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...history.points].reverse().map((point) => (
                        <tr key={point.date}>
                          <td>{dateText(point.date)}</td>
                          <td>{holdingText(point)}</td>
                          <td>{point.shares === null ? '—' : nf(point.shares)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          );
        })}
      </div>
    </div>
  );
}
export function HoldersPane() {
  const { data: market, detail, ticker, selection, select } = useTerminal();
  const range = bounds(selection);
  return (
    <>
      {range && (
        <div className="holder-range" role="status">
          <span>
            Chart range {dateText(range.start)} to {dateText(range.end)}
          </span>
          <button onClick={() => select(null)}>Clear chart range</button>
        </div>
      )}
      <Scroll reset={`${ticker}:${selection?.anchor}:${selection?.end}`}>
        <Availability resource={detail} name="Ownership">
          {(data) => {
            const snapshot = registryAt(
              data,
              range?.end ?? market.health.five_pct ?? data.prices.at(-1)?.date ?? '',
            );
            const histories = holderHistories(data, market.health.five_pct)
              .map((history) => ({
                ...history,
                points: history.points.filter((point) => inRange(point.date, selection)),
              }))
              .filter((history) => history.points.length > 0)
              .sort((a, b) => (b.points.at(-1)?.pct ?? 0) - (a.points.at(-1)?.pct ?? 0));
            return (
              <>
                <dl
                  className="holder-registry"
                  title={snapshot ? `Registry ${dateText(snapshot.date)}` : 'Registry unavailable'}
                >
                  <div>
                    <dt>FREE FLOAT</dt>
                    <dd>
                      {snapshot?.free_float_pct == null
                        ? '—'
                        : `${nf(snapshot.free_float_pct, 2)}%`}
                    </dd>
                  </div>
                  <div>
                    <dt>SID COUNT</dt>
                    <dd>{snapshot?.sid_count == null ? '—' : nf(snapshot.sid_count)}</dd>
                  </div>
                  <div>
                    <dt>ISSUED SHARES</dt>
                    <dd>{snapshot?.issued_shares == null ? '—' : nf(snapshot.issued_shares)}</dd>
                  </div>
                </dl>
                {histories.length ? (
                  <HoldersChart
                    key={`${ticker}:${selection?.anchor}:${selection?.end}`}
                    histories={histories}
                    snapshot={snapshot}
                  />
                ) : (
                  <Empty>
                    {range ? 'No holder reports in this chart range' : 'No holders reported'}
                  </Empty>
                )}
              </>
            );
          }}
        </Availability>
      </Scroll>
    </>
  );
}
export function DisclosuresPane() {
  const { detail, ticker } = useTerminal();
  return (
    <Scroll reset={ticker}>
      <Availability resource={detail} name="Disclosures">
        {(data) =>
          data.disclosures.length ? (
            <table className="disclosures-table">
              <tbody>
                {[...data.disclosures]
                  .sort((a, b) => b.published_at.localeCompare(a.published_at))
                  .map((row) => (
                    <tr key={row.id}>
                      <td className="mut">{dateText(row.published_at)}</td>
                      <td className="l">
                        <a href={row.url} target="_blank" rel="noreferrer">
                          {row.title}
                        </a>
                        <FilingAttachments filing={row} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <Empty>No disclosures for {ticker}</Empty>
          )
        }
      </Availability>
    </Scroll>
  );
}
