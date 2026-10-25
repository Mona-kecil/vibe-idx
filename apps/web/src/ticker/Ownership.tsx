import { useEffect, useRef, useState } from 'react';
import type { Ticker } from '../data';
import {
  bounds,
  composition,
  holderLabel,
  inRange,
  registryAt,
  pctAt,
  sameHolder,
  sharesAt,
  totalAt,
  type HoldingEvent,
  type HoldingSeries,
  type Selection,
} from './logic';
import { dateText, direction, nf, short, signed } from './format';
import { HoldingValue, OwnershipName } from './Feeds';

const palette = [
  '#2858ae',
  '#8a49ac',
  '#bd8312',
  '#d05f19',
  '#168aab',
  '#4443b0',
  '#975d32',
  '#b24c91',
  '#6d6b78',
];
const grays = [
  '#373632',
  '#5c5a55',
  '#7d7a74',
  '#9d9991',
  '#b8b4aa',
  '#ccc8bd',
  '#e1dfd2',
  '#aaa59c',
];
export function Ownership({
  data,
  series,
  events,
  selection,
  dailyDate,
}: {
  data: Ticker;
  series: HoldingSeries[];
  events: HoldingEvent[];
  selection: Selection;
  dailyDate: string | null;
}) {
  const b = bounds(selection),
    end = b?.end ?? dailyDate ?? data.prices.at(-1)?.date ?? '';
  const snapshot = registryAt(data, end);
  const parts = composition(data, series, end);
  const previous = b
    ? (data.prices[data.prices.findIndex((p) => p.date === b.start) - 1]?.date ?? b.start)
    : end;
  const holders = series
    .map((s) => ({ s, shares: sharesAt(s, end), pct: pctAt(data, s, end) }))
    .filter(
      (h): h is { s: HoldingSeries; shares: number; pct: number } =>
        typeof h.shares === 'number' && h.pct !== null && h.pct >= 5,
    )
    .sort((a, b) => b.shares - a.shares);
  const types = [...(snapshot?.investor_types ?? [])]
    .filter((t): t is typeof t & { shares: number } => t.shares !== null)
    .sort((a, b) => b.shares - a.shares);
  const typeParts = types.slice(0, 6).map((t) => ({ label: t.label, shares: t.shares }));
  if (types.length > 6)
    typeParts.push({
      label: 'Other',
      shares: types.slice(6).reduce((sum, t) => sum + t.shares, 0),
    });
  const activity = events.filter((e) => inRange(e.date, selection));
  return (
    <section className="section" id="ownership-section" aria-labelledby="ownership-heading">
      <div className="section-head">
        <h2 id="ownership-heading">Ownership</h2>
        {snapshot && (
          <a
            className="date-label"
            id="registry-source"
            href={snapshot.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {dateText(snapshot.date)} registry
          </a>
        )}
      </div>
      {series.length > 0 && (
        <HoldingsChart data={data} series={series} selection={selection} end={end} />
      )}
      {parts.length > 0 && (
        <>
          <div
            className="ownership-bar"
            id="composition"
            role="img"
            aria-label={`Ownership composition as of ${dateText(end)}`}
          >
            <svg
              viewBox="0 0 100 36"
              preserveAspectRatio="none"
              width="100%"
              height="100%"
              aria-hidden="true"
            >
              {parts.map((part, i) => (
                <rect
                  key={part.name}
                  x={parts.slice(0, i).reduce((sum, p) => sum + p.pct, 0)}
                  width={part.pct}
                  height={36}
                  fill={grays[i % grays.length]}
                >
                  <title>
                    {part.name} {nf(part.pct, 2)}%
                    {part.note ? `  ${dateText(part.note.slice(0, 10))} registry` : ''}
                  </title>
                </rect>
              ))}
            </svg>
          </div>
          <div className="composition-legend">
            {parts.map((part, i) => (
              <div
                key={part.name}
                className="composition-item"
                title={part.note ? `${dateText(part.note.slice(0, 10))} registry` : undefined}
              >
                <i className="swatch" style={{ background: grays[i % grays.length] }} />
                <span className="label">{part.name}</span>
                <strong>{nf(part.pct, 2)}%</strong>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="ownership-grid">
        <div>
          <div className="subhead">
            <h3>5% holders</h3>
            <span className="date-label" id="holders-date">
              {end && dateText(end)}
            </span>
          </div>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Five percent shareholders"
          >
            <table className="holder-table">
              <thead>
                <tr>
                  <th>Investor</th>
                  <th className="num">Shares</th>
                  <th className="num">Holding</th>
                </tr>
              </thead>
              <tbody id="holders">
                {holders.map(({ s, shares, pct }) => {
                  const role = snapshot?.holders.find((h) => sameHolder(h.investor, s.name));
                  const changed = !!selection && s.events.some((e) => inRange(e.date, selection));
                  const before = sharesAt(s, previous),
                    source =
                      s.events
                        .filter((e) => e.date <= end && e.sources.length)
                        .sort((a, b) => b.date.localeCompare(a.date))[0]?.sources[0] ??
                      snapshot?.url;
                  return (
                    <tr key={s.name} data-holder={s.name} data-shares={shares}>
                      <td>
                        {source ? (
                          <a href={source} target="_blank" rel="noopener noreferrer">
                            {s.name}
                          </a>
                        ) : (
                          s.name
                        )}
                        {(role?.controller || role?.controller_affiliate) && (
                          <span className="role">
                            {role.controller ? 'Controller' : 'Controller affiliate'}
                          </span>
                        )}
                      </td>
                      <td className="num" title={nf(shares) + ' shares'}>
                        {changed ? (
                          <span className="holder-transition">
                            {typeof before === 'number' ? nf(before) : '—'} → {nf(shares)}
                          </span>
                        ) : (
                          nf(shares)
                        )}
                      </td>
                      <td className="num">{nf(pct, 2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!holders.length && (
              <p className="empty-state">No holdings reported as of {dateText(end)}</p>
            )}
          </div>
          {typeParts.length > 0 && (
            <div className="types">
              <div className="subhead">
                <h3>Investor types</h3>
                <span className="date-label" id="types-date">
                  {snapshot && dateText(snapshot.date)}
                </span>
              </div>
              <div id="investor-types">
                {typeParts.map((t) => (
                  <div key={t.label} className="type-row">
                    <span className="type-label">{t.label.replace(/ \([A-Z]+\)$/, '')}</span>
                    <svg className="type-track" width="100%" height="7" aria-hidden="true">
                      <rect
                        width={`${(t.shares / (types[0]?.shares || 1)) * 100}%`}
                        height="7"
                        fill="#77746e"
                      />
                    </svg>
                    <span className="type-number" title={nf(t.shares) + ' shares'}>
                      {short(t.shares)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div>
          <div className="subhead">
            <h3>Ownership activity</h3>
            <span className="date-label">Net shares</span>
          </div>
          <div className="timeline" id="activity">
            {activity.map((e) => {
              const net =
                  e.shares_before === null || e.shares_after === null
                    ? null
                    : e.shares_after - e.shares_before,
                total = totalAt(data, e.date);
              return (
                <div className="event" key={e.name + e.date} data-date={e.date}>
                  <time className="event-date" dateTime={e.date}>
                    {dateText(e.date, false)}
                    <br />
                    {e.date.slice(0, 4)}
                  </time>
                  <div className="event-name">
                    <OwnershipName event={e} />
                  </div>
                  <div
                    className={`event-value ${direction(net)}`}
                    title={net === null ? 'Below 5%' : signed(net, nf) + ' shares'}
                  >
                    {net === null ? (
                      'Below 5%'
                    ) : (
                      <>
                        {signed(net)}{' '}
                        {total && (
                          <span className="event-pct">
                            ({signed((net / total) * 100, (v) => nf(v, 2))}%)
                          </span>
                        )}
                      </>
                    )}
                    <small>
                      After: <HoldingValue data={data} event={e} side="after" />
                    </small>
                  </div>
                </div>
              );
            })}
            {!activity.length && (
              <p className="empty-state">
                No ownership changes
                {b ? ` ${dateText(b.start, false)}–${dateText(b.end, false)}` : ''}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
function HoldingsChart({
  data,
  series,
  selection,
  end,
}: {
  data: Ticker;
  series: HoldingSeries[];
  selection: Selection;
  end: string;
}) {
  const [unit, setUnit] = useState<'shares' | 'pct'>('shares');
  const [hidden, setHidden] = useState<string[]>([]),
    [focus, setFocus] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ event: HoldingEvent; x: number; y: number } | null>(
    null,
  );
  const shell = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(948);
  useEffect(() => {
    const element = shell.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    setWidth(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTooltip(null);
        setFocus(null);
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, []);
  const firstDate = series
    .flatMap((s) => s.points)
    .map((p) => p.date)
    .sort()[0];
  const lastDate = [
    data.prices.at(-1)?.date ?? '',
    ...series.flatMap((s) => s.points).map((p) => p.date),
  ]
    .sort()
    .at(-1);
  if (!firstDate || !lastDate) return null;
  const W = width,
    L = 42,
    R = 118,
    T = 46,
    B = 316,
    start = Date.parse(firstDate),
    finish = Date.parse(lastDate),
    plot = W - L - R;
  const x = (date: string) => L + ((Date.parse(date) - start) / Math.max(1, finish - start)) * plot;
  const amount = (shares: number, date: string) =>
    unit === 'shares' ? shares : (shares / (totalAt(data, date) || Infinity)) * 100;
  const peak = Math.max(
    1,
    ...series
      .filter((s) => !hidden.includes(s.name))
      .flatMap((s) => s.points.map((p) => amount(p.shares ?? 0, p.date))),
  );
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const yMax = Math.ceil((peak * 1.03) / (magnitude / 2)) * (magnitude / 2),
    y = (value: number) => B - (value / yMax) * (B - T);
  const b = bounds(selection);
  const snapshots = [...data.registry_history].sort((a, b) => a.date.localeCompare(b.date));
  const issues = snapshots.flatMap((s, i) => {
    const previous = snapshots[i - 1];
    return previous?.total_shares && s.total_shares && s.total_shares !== previous.total_shares
      ? [{ start: previous, end: s }]
      : [];
  });
  const monthTicks: string[] = [];
  const tick = new Date(firstDate + 'T00:00:00Z');
  tick.setUTCDate(1);
  if (tick.getTime() < start) tick.setUTCMonth(tick.getUTCMonth() + 1);
  while (tick.getTime() <= finish) {
    monthTicks.push(tick.toISOString().slice(0, 10));
    tick.setUTCMonth(tick.getUTCMonth() + 1);
  }
  const labels = series
    .map((s, i) => ({ s, i, y: y(amount(sharesAt(s, lastDate) ?? 0, lastDate)), labelY: 0 }))
    .filter((l) => !hidden.includes(l.s.name))
    .sort((a, b) => a.y - b.y);
  labels.forEach((l, i) => {
    l.labelY = Math.max(l.y, i ? (labels[i - 1]?.labelY ?? T) + 14 : T);
  });
  const overflow = Math.max(0, (labels.at(-1)?.labelY ?? B) - B);
  labels.forEach((l) => {
    l.labelY -= overflow;
  });
  return (
    <>
      <div className="holdings-head">
        <h3>Holdings over time</h3>
        <div className="ranges holdings-mode" aria-label="Holdings unit">
          {(['shares', 'pct'] as const).map((mode) => (
            <button
              key={mode}
              data-unit={mode}
              aria-pressed={mode === unit}
              onClick={() => {
                setUnit(mode);
                setTooltip(null);
              }}
            >
              {mode === 'shares' ? 'Shares' : '%'}
            </button>
          ))}
        </div>
      </div>
      <div className="holdings-layout">
        <div
          className="holdings-shell"
          id="holdings-shell"
          ref={shell}
          onPointerLeave={() => {
            setTooltip(null);
            setFocus(null);
          }}
        >
          <svg
            id="holdings-chart"
            className="holdings-svg"
            viewBox={`0 0 ${W} 350`}
            role="img"
            aria-label={`Major shareholder holdings from ${dateText(firstDate)} to ${dateText(lastDate)}`}
          >
            {b && (
              <g className="holdings-selection">
                <rect
                  className="selection-fill"
                  x={x(b.start) - (b.start === b.end ? 2 : 0)}
                  y={30}
                  width={Math.max(1, x(b.end) - x(b.start) + (b.start === b.end ? 4 : 0))}
                  height={B - 30}
                />
                <path
                  className="selection-edge"
                  d={`M${x(b.start)},30 V${B} M${x(b.end)},30 V${B}`}
                />
              </g>
            )}
            {issues.map((issue) => (
              <g key={issue.end.date}>
                <title>
                  Exact date not in registry data; between {dateText(issue.start.date)} and{' '}
                  {dateText(issue.end.date)}
                </title>
                <rect
                  x={x(issue.start.date)}
                  y={30}
                  width={x(issue.end.date) - x(issue.start.date)}
                  height={B - 30}
                  fill="#aaa58d"
                  opacity=".12"
                />
                <text x={(x(issue.start.date) + x(issue.end.date)) / 2} y={19} textAnchor="middle">
                  Total shares{' '}
                  <tspan dx={7}>
                    {short(issue.start.total_shares ?? 0)} → {short(issue.end.total_shares ?? 0)}{' '}
                    shares
                  </tspan>
                </text>
              </g>
            ))}
            {Array.from({ length: 6 }, (_, i) => {
              const v = (yMax * i) / 5;
              return (
                <g key={i}>
                  <line
                    x1={L}
                    x2={W - R}
                    y1={y(v)}
                    y2={y(v)}
                    stroke="#e3e3da"
                    strokeDasharray="2 4"
                  />
                  <text x={L - 9} y={y(v) + 4} textAnchor="end">
                    {unit === 'shares' ? v / 1e6 + 'M' : nf(v) + '%'}
                  </text>
                </g>
              );
            })}
            {monthTicks.map((d) => (
              <g key={d}>
                <line x1={x(d)} x2={x(d)} y1={B} y2={B + 4} stroke="#c6c6ba" />
                <text x={x(d)} y={340} textAnchor="middle">
                  {new Date(d).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}
                </text>
              </g>
            ))}
            {series.map((s, i) => {
              if (hidden.includes(s.name)) return null;
              const color = palette[i % palette.length],
                last = s.points.at(-1),
                label = labels.find((l) => l.s === s);
              const points = last
                ? [...s.points, { ...last, date: lastDate, event: false }]
                : s.points;
              const lineY = (p: { shares: number | null; date: string }) => {
                const value = amount(p.shares ?? 0, p.date),
                  peers = series.filter(
                    (t) =>
                      !hidden.includes(t.name) &&
                      amount(sharesAt(t, p.date) ?? 0, p.date) === value,
                  );
                return (
                  y(value) +
                  (value > 0 && peers.length > 1
                    ? (peers.indexOf(s) - (peers.length - 1) / 2) * 3
                    : 0)
                );
              };
              const name = holderLabel(s.name)
                .split(' ')
                .slice(0, 2)
                .map((word) => word[0]?.toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');
              return (
                <g
                  className="holdings-series"
                  data-holder={i}
                  key={s.name}
                  style={{ opacity: focus && focus !== s.name ? 0.15 : 1 }}
                  onPointerEnter={() => setFocus(s.name)}
                  onPointerLeave={() => setFocus(null)}
                >
                  {points.map((p, j) => {
                    const prior = points[j - 1];
                    if (!prior || p.shares === null || prior.shares === null) return null;
                    const event = s.events.some((e) => e.date === p.date),
                      dotted =
                        !event && amount(prior.shares, prior.date) !== amount(p.shares, p.date);
                    return (
                      <path
                        key={j}
                        className={`holding-line${dotted ? ' holding-uncertain' : ''}`}
                        d={
                          event
                            ? `M${x(prior.date)},${lineY(prior)} H${x(p.date)} V${lineY(p)}`
                            : `M${x(prior.date)},${lineY(prior)} L${x(p.date)},${lineY(p)}`
                        }
                        stroke={color}
                        strokeWidth={focus === s.name ? 2.6 : 2}
                        strokeDasharray={dotted ? '2 4' : undefined}
                        strokeLinecap="round"
                        fill="none"
                        strokeLinejoin="round"
                      />
                    );
                  })}
                  {s.events
                    .filter((e) => e.shares_after !== null)
                    .map((e) => {
                      const cx = x(e.date),
                        cy = lineY({ date: e.date, shares: e.shares_after });
                      const show = () => {
                        setFocus(s.name);
                        setTooltip({
                          event: e,
                          x: Math.max(0, Math.min(W - 340, cx > W / 2 ? cx - 356 : cx + 16)),
                          y: Math.max(34, Math.min(180, cy - 40)),
                        });
                      };
                      return (
                        <circle
                          className="holding-event"
                          key={e.date}
                          data-date={e.date}
                          cx={cx}
                          cy={cy}
                          r={4.5}
                          fill={color}
                          stroke="var(--paper)"
                          strokeWidth={1.5}
                          tabIndex={0}
                          role="button"
                          aria-label={`${s.name} ${dateText(e.date)} ${nf(e.shares_before ?? 0)} → ${nf(e.shares_after ?? 0)} shares`}
                          onPointerEnter={show}
                          onFocus={show}
                          onClick={show}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              show();
                            }
                          }}
                        />
                      );
                    })}
                  {last && label && (
                    <>
                      <path
                        d={`M${W - R},${lineY({ ...last, date: lastDate })} L${W - R + 9},${label.labelY}`}
                        stroke={color}
                        fill="none"
                        strokeWidth={1}
                      />
                      <text
                        className="holding-label"
                        x={W - R + 13}
                        y={label.labelY + 3}
                        style={{ fill: color }}
                      >
                        {name}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
          {tooltip && (
            <div
              id="holdings-tooltip"
              className="tooltip holdings-tooltip"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              <div className="tooltip-date">{dateText(tooltip.event.date)}</div>
              <strong>
                <OwnershipName event={tooltip.event} />
              </strong>
              <div className="holding-transition">
                <HoldingValue data={data} event={tooltip.event} side="before" /> →{' '}
                <HoldingValue data={data} event={tooltip.event} side="after" />
                {tooltip.event.shares_before !== null && tooltip.event.shares_after !== null && (
                  <span
                    className={`event-delta ${direction(tooltip.event.shares_after - tooltip.event.shares_before)}`}
                    title={
                      signed(tooltip.event.shares_after - tooltip.event.shares_before, nf) +
                      ' shares'
                    }
                  >
                    {signed(tooltip.event.shares_after - tooltip.event.shares_before)}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="holdings-legend">
          {series.map((s, i) => {
            const shares = sharesAt(s, end),
              pct = pctAt(data, s, end);
            return (
              <button
                className="holder-key"
                key={s.name}
                data-holder={i}
                aria-pressed={!hidden.includes(s.name)}
                onClick={() => {
                  setHidden(
                    hidden.includes(s.name)
                      ? hidden.filter((n) => n !== s.name)
                      : [...hidden, s.name],
                  );
                  setTooltip(null);
                }}
                onPointerEnter={() => setFocus(s.name)}
                onPointerLeave={() => setFocus(null)}
              >
                <i className="swatch" style={{ background: palette[i % palette.length] }} />
                <span>{holderLabel(s.name)}</span>
                <strong
                  title={
                    typeof shares === 'number'
                      ? nf(shares) + ' shares'
                      : `Not reported as of ${dateText(end)}`
                  }
                >
                  {typeof shares === 'number' ? short(shares) : '—'}
                  {typeof shares === 'number' && pct !== null && <small>{nf(pct, 2)}%</small>}
                </strong>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
