import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  aggregateRange,
  bounds,
  moveEdge,
  selectionKey,
  type Edge,
  type Price,
  type Selection,
} from './logic';
import { dateText, direction, nf, rangeText, short, signed } from './format';

export type Period = '1M' | '3M' | '6M' | 'YTD';
export function visiblePrices(prices: Price[], period: Period) {
  const last = prices.at(-1);
  if (!last || period === 'YTD') return prices;
  const start = new Date(last.date + 'T00:00:00Z');
  start.setUTCMonth(start.getUTCMonth() - parseInt(period));
  return prices.filter((p) => p.date >= start.toISOString().slice(0, 10));
}
export function SelectionLabel({ prices, selection }: { prices: Price[]; selection: Selection }) {
  const b = bounds(selection),
    totals = aggregateRange(prices, selection);
  if (!b || !totals) return null;
  return (
    <>
      <span className="selection-dates">{rangeText(b.start, b.end)}</span>
      <span className="selection-count">
        <span>
          {totals.rows.length} trading {totals.rows.length === 1 ? 'day' : 'days'}
        </span>
        {totals.suspended > 0 && <span>{totals.suspended} suspended</span>}
      </span>
    </>
  );
}
export function PriceChart({
  ticker,
  prices,
  period,
  setPeriod,
  selection,
  select,
  children,
}: {
  ticker: string;
  prices: Price[];
  period: Period;
  setPeriod: (p: Period) => void;
  selection: Selection;
  select: (s: Selection) => void;
  children: React.ReactNode;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ kind: 'range'; anchor: string } | { kind: 'edge'; edge: Edge } | null>(
    null,
  );
  const [width, setWidth] = useState(1248);
  const [hover, setHover] = useState<number | null>(null);
  const [docked, setDocked] = useState(false);
  const visible = visiblePrices(prices, period);
  const first = visible[0],
    last = visible.at(-1);
  const b = bounds(selection);
  useEffect(() => {
    const element = shell.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    setWidth(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const scroll = () => setDocked((shell.current?.getBoundingClientRect().bottom ?? 1) <= 0);
    scroll();
    window.addEventListener('scroll', scroll, { passive: true });
    return () => window.removeEventListener('scroll', scroll);
  }, []);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (
        e.key !== 'Escape' &&
        e.target instanceof HTMLElement &&
        /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)
      )
        return;
      if (!selection) return;
      const focused = document.activeElement?.getAttribute('data-edge');
      const edge = focused === 'start' || focused === 'end' ? focused : undefined;
      if (
        e.key === 'Escape' ||
        ['ArrowLeft', 'ArrowRight'].includes(e.key) ||
        (edge && ['Home', 'End'].includes(e.key))
      ) {
        e.preventDefault();
        setHover(null);
        select(
          selectionKey(
            selection,
            prices.map((p) => p.date),
            e.key,
            e.shiftKey,
            edge,
          ),
        );
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [selection, prices, select]);
  if (!first || !last)
    return (
      <section className="section">
        <h2>Price & volume</h2>
        <p className="empty-state">No price data</p>
      </section>
    );
  const mobile = width < 650,
    W = width,
    H = mobile ? 400 : 455,
    L = mobile ? 5 : 8,
    R = mobile ? 49 : 64;
  const plot = W - L - R,
    T = 22,
    priceBottom = mobile ? 224 : 260,
    volTop = mobile ? 261 : 296,
    volBottom = mobile ? 311 : 351,
    foreignTop = mobile ? 337 : 376,
    foreignBottom = mobile ? 369 : 416;
  const min = Math.min(...visible.map((p) => p.close)),
    max = Math.max(...visible.map((p) => p.close)),
    pad = (max - min) * 0.12 || 100,
    lo = Math.max(0, min - pad),
    hi = max + pad;
  const x = (i: number) => L + (i / Math.max(1, visible.length - 1)) * plot;
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (priceBottom - T);
  const maxVolume = Math.max(1, ...visible.map((p) => p.volume)),
    maxForeign = Math.max(1, ...visible.map((p) => Math.abs(p.net_foreign))),
    midForeign = (foreignTop + foreignBottom) / 2;
  const bw = Math.max(1, (plot / visible.length) * 0.65),
    half = plot / Math.max(1, visible.length - 1) / 2;
  const startIndex = prices.indexOf(first);
  const dayX = (day: string) => x(prices.findIndex((p) => p.date === day) - startIndex);
  const left = b ? Math.max(L, dayX(b.start) - (b.start === b.end ? half : 0)) : 0;
  const right = b ? Math.min(W - R, dayX(b.end) + (b.start === b.end ? half : 0)) : 0;
  const selectionVisible = b && right >= left;
  const bands: { start: number; end: number }[] = [];
  visible.forEach((p, i) => {
    if (p.volume !== 0) return;
    const previous = bands.at(-1);
    if (previous && previous.end === i - 1) previous.end = i;
    else bands.push({ start: i, end: i });
  });
  function indexAt(e: PointerEvent<SVGSVGElement>) {
    return Math.max(
      0,
      Math.min(
        visible.length - 1,
        Math.round(
          ((e.clientX - e.currentTarget.getBoundingClientRect().left - L) / plot) *
            (visible.length - 1),
        ),
      ),
    );
  }
  const hoverRow = hover === null ? undefined : visible[hover];
  const hoverTotal = hoverRow
    ? aggregateRange(prices, { anchor: hoverRow.date, end: hoverRow.date })
    : null;
  const marker =
    hover ??
    (selection?.anchor === selection?.end
      ? visible.findIndex((p) => p.date === selection?.end)
      : -1);
  const markerRow = visible[marker];
  const periodChange = first.close ? (last.close / first.close - 1) * 100 : 0;
  return (
    <>
      <div id="selection-sticky" hidden={!selection || !docked}>
        <div className="wrap">
          <span id="sticky-label">
            <SelectionLabel prices={prices} selection={selection} />
          </span>
          <button aria-label="Clear selection" onClick={() => select(null)}>
            ×
          </button>
        </div>
      </div>
      <section className="section" id="price-section" aria-labelledby="price-heading">
        <div className="section-head">
          <h2 id="price-heading">Price & volume</h2>
          <div className="ranges" aria-label="Chart period">
            {(['1M', '3M', '6M', 'YTD'] satisfies Period[]).map((p) => (
              <button
                key={p}
                data-range={p}
                aria-pressed={p === period}
                onClick={() => {
                  setHover(null);
                  setPeriod(p);
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-summary">
          <strong className={direction(periodChange)}>
            {signed(periodChange, (v) => nf(v, 2))}%
          </strong>
          <span>{period}</span>
          <span className="date-label">
            {dateText(first.date, false)} – {dateText(last.date)}
          </span>
        </div>
        <div className="chart-shell" id="chart-shell" ref={shell}>
          <svg
            ref={svg}
            id="price-chart"
            className="chart-svg"
            viewBox={`0 0 ${W} ${H}`}
            role="group"
            aria-label={`${ticker} close price, trading volume and net foreign flow`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              const day = visible[indexAt(e)]?.date;
              if (!day) return;
              const target = e.target instanceof Element ? e.target.closest('[data-edge]') : null;
              const edge = target?.getAttribute('data-edge');
              if (!e.shiftKey && (edge === 'start' || edge === 'end')) {
                gesture.current = { kind: 'edge', edge };
                if (target instanceof SVGElement) target.focus();
              } else {
                if (
                  document.activeElement instanceof SVGElement &&
                  document.activeElement.hasAttribute('data-edge')
                )
                  document.activeElement.blur();
                const anchor = e.shiftKey && selection ? selection.anchor : day;
                gesture.current = { kind: 'range', anchor };
                select({ anchor, end: day });
              }
              e.currentTarget.setPointerCapture(e.pointerId);
              setHover(null);
            }}
            onPointerMove={(e) => {
              const index = indexAt(e),
                day = visible[index]?.date;
              const drag = gesture.current;
              if (!drag) {
                setHover(index);
                return;
              }
              if (!day) return;
              if (drag.kind === 'edge' && selection) select(moveEdge(selection, drag.edge, day));
              else if (drag.kind === 'range') select({ anchor: drag.anchor, end: day });
            }}
            onPointerUp={(e) => {
              const drag = gesture.current;
              gesture.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
              if (drag?.kind === 'edge')
                svg.current?.querySelector<SVGElement>(`[data-edge="${drag.edge}"]`)?.focus();
            }}
            onPointerCancel={() => {
              gesture.current = null;
            }}
            onPointerLeave={() => setHover(null)}
          >
            {bands.map((band) => {
              const l = Math.max(L, x(band.start) - half),
                r = Math.min(W - R, x(band.end) + half);
              return (
                <g key={band.start}>
                  <rect
                    className="suspension-band"
                    x={l}
                    y={0}
                    width={r - l}
                    height={foreignBottom}
                    fill="#999587"
                    opacity=".13"
                  />
                  <text className="suspension-label" x={(l + r) / 2} y={13} textAnchor="middle">
                    Suspended
                  </text>
                </g>
              );
            })}
            {Array.from({ length: 5 }, (_, i) => {
              const v = lo + ((hi - lo) * i) / 4;
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
                  <text x={W - R + 10} y={y(v) + 4}>
                    {nf(Math.round(v / 100) * 100)}
                  </text>
                </g>
              );
            })}
            {visible.map((p, i) => {
              const a = visible[i - 1];
              if (!a) return null;
              const suspended = a.volume === 0 || p.volume === 0;
              return (
                <g key={p.date}>
                  {!suspended && (
                    <path
                      d={`M${x(i - 1)},${y(a.close)} L${x(i)},${y(p.close)} L${x(i)},${priceBottom} L${x(i - 1)},${priceBottom} Z`}
                      fill="#77746e"
                      fillOpacity=".075"
                    />
                  )}
                  <path
                    d={`M${x(i - 1)},${y(a.close)} L${x(i)},${y(p.close)}`}
                    fill="none"
                    stroke="#30312e"
                    strokeWidth="1.8"
                    strokeDasharray={suspended ? '3 4' : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
            <circle cx={x(visible.length - 1)} cy={y(last.close)} r={3} fill="#30312e" />
            <rect
              x={W - R + 4}
              y={y(last.close) - 10}
              width={R - 4}
              height={20}
              rx={3}
              fill="#30312e"
            />
            <text x={W - R + 9} y={y(last.close) + 4} style={{ fill: '#fff', fontWeight: 700 }}>
              {nf(last.close)}
            </text>
            <text className="axis-label" x={L} y={volTop - 10}>
              Volume
            </text>
            <text x={W - R + 9} y={volTop + 5}>
              {short(maxVolume)}
            </text>
            <text className="axis-label" x={L} y={foreignTop - 10}>
              Net foreign{' '}
              <tspan dx={6} className="axis-unit">
                IDR (est.)
              </tspan>
            </text>
            <text x={W - R + 9} y={foreignTop + 5}>
              {short(maxForeign)}
            </text>
            <line x1={L} x2={W - R} y1={midForeign} y2={midForeign} stroke="#d0d2c6" />
            {visible.map((p, i) => {
              const vh = (p.volume / maxVolume) * (volBottom - volTop),
                fh = ((Math.abs(p.net_foreign) / maxForeign) * (foreignBottom - foreignTop)) / 2;
              return (
                <g key={p.date}>
                  <rect
                    x={x(i) - bw / 2}
                    y={volBottom - vh}
                    width={bw}
                    height={vh}
                    fill="#aaa79e"
                  />
                  <rect
                    x={x(i) - bw / 2}
                    y={p.net_foreign >= 0 ? midForeign - fh : midForeign}
                    width={bw}
                    height={fh}
                    fill={p.net_foreign >= 0 ? '#167049' : '#b43c36'}
                    opacity=".8"
                  />
                </g>
              );
            })}
            {Array.from({ length: mobile ? 4 : 7 }).map((_, i, all) => {
              const index = Math.round((i / (all.length - 1)) * (visible.length - 1));
              const p = visible[index];
              return (
                p && (
                  <text
                    key={i}
                    x={x(index)}
                    y={H - 7}
                    textAnchor={i === 0 ? 'start' : i === all.length - 1 ? 'end' : 'middle'}
                  >
                    {dateText(p.date, false)}
                  </text>
                )
              );
            })}
            {markerRow && (
              <g pointerEvents="none">
                <line
                  x1={x(marker)}
                  x2={x(marker)}
                  y1={T}
                  y2={foreignBottom}
                  stroke="#84887b"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={x(marker)}
                  cy={y(markerRow.close)}
                  r={4}
                  fill="#fdfcf9"
                  stroke="#30312e"
                  strokeWidth={2}
                />
              </g>
            )}
            <rect
              id="chart-hit"
              x={L}
              y={0}
              width={plot}
              height={foreignBottom}
              fill="transparent"
            />
            {selectionVisible && (
              <g>
                <rect
                  className="selection-fill"
                  x={left}
                  y={0}
                  width={Math.max(1, right - left)}
                  height={foreignBottom}
                />
                {(['start', 'end'] satisfies Edge[]).map((edge) => {
                  const day = b[edge];
                  if (day < first.date || day > last.date) return null;
                  const position = edge === 'start' ? left : right;
                  return (
                    <g key={edge}>
                      <line
                        className="selection-edge"
                        x1={position}
                        x2={position}
                        y1={0}
                        y2={foreignBottom}
                      />
                      <g
                        className="selection-handle"
                        data-edge={edge}
                        role="slider"
                        tabIndex={0}
                        aria-label={edge === 'start' ? 'Range start' : 'Range end'}
                        aria-orientation="horizontal"
                        aria-valuemin={
                          edge === 'start' ? 0 : prices.findIndex((p) => p.date === b.start)
                        }
                        aria-valuemax={
                          edge === 'start'
                            ? prices.findIndex((p) => p.date === b.end)
                            : prices.length - 1
                        }
                        aria-valuenow={prices.findIndex((p) => p.date === day)}
                        aria-valuetext={dateText(day)}
                        transform={`translate(${position},0)`}
                      >
                        <rect className="handle-hit" x={-12} y={104} width={24} height={46} />
                        <rect
                          className="handle-grip"
                          x={-5}
                          y={112}
                          width={10}
                          height={30}
                          rx={3}
                        />
                        <path d="M-1.5 121v12 M1.5 121v12" stroke="#566d8a" strokeWidth={1} />
                      </g>
                    </g>
                  );
                })}
              </g>
            )}
          </svg>
          {hoverRow && hoverTotal && (
            <div
              className="tooltip"
              id="chart-tooltip"
              style={{
                left: Math.max(
                  0,
                  Math.min(W - 226, x(hover ?? 0) + (x(hover ?? 0) > W / 2 ? -241 : 15)),
                ),
                top: 37,
              }}
            >
              <div className="tooltip-date">{dateText(hoverRow.date)}</div>
              <dl>
                <dt>
                  Close <small className="unit-suffix">IDR</small>
                </dt>
                <dd>{nf(hoverRow.close)}</dd>
                <dt>Change</dt>
                <dd className={direction(hoverTotal.change)}>
                  {hoverTotal.change === null
                    ? '—'
                    : `${signed(hoverTotal.change, nf)} (${signed(hoverTotal.changePct ?? 0, (v) => nf(v, 2))}%)`}
                </dd>
                {hoverRow.volume === 0 ? (
                  <>
                    <dt>Status</dt>
                    <dd>Suspended</dd>
                  </>
                ) : (
                  <>
                    <dt>Volume</dt>
                    <dd>{nf(hoverRow.volume)}</dd>
                    <dt>
                      Value <small className="unit-suffix">IDR</small>
                    </dt>
                    <dd>{nf(hoverRow.value)}</dd>
                    <dt>Net foreign (est.)</dt>
                    <dd className={direction(hoverRow.net_foreign)}>
                      {signed(hoverRow.net_foreign, nf)}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </div>
        <div id="selection-axis" hidden={!selectionVisible}>
          <div id="selection-bracket" style={{ left, width: Math.max(1, right - left) }} />
          <div
            id="selection-label"
            style={{ left: Math.max(100, Math.min(W - 100, (left + right) / 2)) }}
          >
            <SelectionLabel prices={prices} selection={selection} />
          </div>
        </div>
        <div className="chart-legend">
          <span>
            <i className="legend-line" />
            Close <small className="unit-suffix">IDR</small>
          </span>
          <span>
            <i className="legend-square" />
            Volume <small className="unit-suffix">shares</small>
          </span>
        </div>
        {children}
      </section>
    </>
  );
}
