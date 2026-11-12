import { ChartAttribution } from '../ChartAttribution';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import {
  AreaSeries,
  BaselineSeries,
  CandlestickSeries,
  createSeriesMarkers,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type IRange,
  type ISeriesApi,
  type Logical,
} from 'lightweight-charts';
import { chartDate, dailyBars, publicChart, type PriceBar } from '../terminal/charts';
import { toneOf, type Tone } from '../area';
import { useNarrow } from '../useNarrow';
import { readStorage, writeStorage } from '../watchlist';
import { chartTheme as theme, paneLabel } from './chartTheme';
import { dateText, direction, nf, rangeText, short, signed } from './format';
import {
  aggregateRange,
  bounds,
  cumulativeForeign,
  periodRange,
  selectedRows,
  selectionKey,
  visibleWindow,
  type Period,
  type Price,
  type ChartMark,
  type RowWindow,
  type Selection,
} from './logic';

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

const periods = ['1M', '3M', '6M', 'YTD'] satisfies Period[];
const chartTypes = { candles: 'Candles', line: 'Line' };
type ChartType = keyof typeof chartTypes;
const typeKey = 'ticker:chart:type';

type ChartRow = PriceBar & { netForeign: number };
const chartRows = (prices: Price[]): ChartRow[] =>
  dailyBars(prices).map((bar, i) => ({ ...bar, netForeign: prices[i]?.net_foreign ?? 0 }));
// Missing OHLC and suspended days have no range to show, so they draw flat and neutral.
const tone = (row: ChartRow) =>
  row.estimated || row.volume === 0 ? theme.flat : row.close >= row.open ? theme.up : theme.down;
const flowTone = (value: number) => (value >= 0 ? theme.up : theme.down);

const paneHeights = {
  wide: [420, 90, 90, 110],
  narrow: [230, 44, 44, 60],
};
const toneColor: Record<Tone, string> = { up: theme.up, down: theme.down, flat: theme.flat };
const areaColors = (tone: Tone) => ({
  lineColor: toneColor[tone],
  topColor: `${toneColor[tone]}38`,
  bottomColor: `${toneColor[tone]}00`,
});
const noMarks: ChartMark[] = [];
const markStyle = {
  filing: { position: 'belowBar', shape: 'circle', color: theme.text },
  ownership: { position: 'aboveBar', shape: 'circle', color: '#2858ae' },
  action: { position: 'belowBar', shape: 'arrowUp', color: '#8a5a00' },
} as const;
const paneLabels = [
  ['Price', 'IDR'],
  ['Volume', 'shares'],
  ['Net foreign', 'IDR (est.)'],
  ['Cumulative foreign', 'IDR (est.)'],
] as const;
const AXIS_HEIGHT = 29;

function cumulativeData(prices: Price[], { first, last }: RowWindow) {
  const window = prices.slice(first, last + 1);
  const sums = cumulativeForeign(window);
  return window.map((price, i) => ({ time: price.date, value: sums[i] ?? 0 }));
}

function addPanes(api: IChartApi, rows: ChartRow[], type: ChartType, heights: readonly number[]) {
  let price: ISeriesApi<'Candlestick'> | ISeriesApi<'Area'>;
  const priceFormat = { type: 'custom', minMove: 1, formatter: (v: number) => nf(v) } as const;
  const flow = { type: 'custom', minMove: 1, formatter: (v: number) => signed(v) } as const;
  if (type === 'candles') {
    price = api.addSeries(
      CandlestickSeries,
      {
        upColor: theme.up,
        downColor: theme.down,
        wickUpColor: theme.up,
        wickDownColor: theme.down,
        borderVisible: false,
        priceFormat,
      },
      0,
    );
    price.setData(
      rows.map((row) => ({
        time: row.time,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        color: tone(row),
        wickColor: tone(row),
        borderColor: tone(row),
      })),
    );
  } else {
    const area = api.addSeries(AreaSeries, { ...areaColors('flat'), lineWidth: 2, priceFormat }, 0);
    area.setData(rows.map((row) => ({ time: row.time, value: row.close })));
    price = area;
  }
  api
    .addSeries(
      HistogramSeries,
      {
        priceFormat: { type: 'custom', minMove: 1, formatter: (v: number) => short(v) },
        lastValueVisible: false,
        priceLineVisible: false,
      },
      1,
    )
    .setData(rows.map((row) => ({ time: row.time, value: row.volume, color: `${tone(row)}73` })));
  const netForeign = api.addSeries(
    HistogramSeries,
    { priceFormat: flow, lastValueVisible: false, priceLineVisible: false },
    2,
  );
  netForeign.setData(
    rows.map((row) => ({
      time: row.time,
      value: row.netForeign,
      color: `${flowTone(row.netForeign)}cc`,
    })),
  );
  const cumulative =
    heights.length > 3
      ? api.addSeries(
          BaselineSeries,
          {
            baseValue: { type: 'price', price: 0 },
            topLineColor: theme.up,
            topFillColor1: `${theme.up}40`,
            topFillColor2: `${theme.up}08`,
            bottomLineColor: theme.down,
            bottomFillColor1: `${theme.down}08`,
            bottomFillColor2: `${theme.down}40`,
            lineWidth: 2,
            priceFormat: flow,
            priceLineVisible: false,
          },
          3,
        )
      : null;
  for (const series of cumulative ? [netForeign, cumulative] : [netForeign])
    series.createPriceLine({
      price: 0,
      color: theme.line,
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: false,
    });
  api.priceScale('right', 0).applyOptions({ scaleMargins: { top: 0.1, bottom: 0.06 } });
  api.priceScale('right', 1).applyOptions({ scaleMargins: { top: 0.3, bottom: 0 } });
  api.priceScale('right', 2).applyOptions({ scaleMargins: { top: 0.3, bottom: 0.08 } });
  if (cumulative)
    api.priceScale('right', 3).applyOptions({ scaleMargins: { top: 0.3, bottom: 0.08 } });
  api.panes().forEach((pane, i) => {
    pane.setStretchFactor(heights[i] ?? 1);
    const [name, unit] = paneLabels[i] ?? ['', ''];
    pane.attachPrimitive(paneLabel(name, unit));
  });
  return { price, cumulative };
}

export function PriceChart({
  ticker,
  prices,
  period,
  setPeriod,
  selection,
  select,
  marks = noMarks,
  children,
}: {
  ticker: string;
  prices: Price[];
  period: Period;
  setPeriod: (p: Period) => void;
  selection: Selection;
  select: (s: Selection) => void;
  marks?: ChartMark[];
  children: ReactNode;
}) {
  const narrow = useNarrow();
  const rows = useMemo(() => chartRows(prices), [prices]);
  const [type, setType] = useState<ChartType>(() => {
    const saved = readStorage(typeKey);
    return saved === 'line' || saved === 'candles' ? saved : narrow ? 'line' : 'candles';
  });
  const [totalOpen, setTotalOpen] = useState(false);
  const withTotal = !narrow || totalOpen;
  const [hover, setHover] = useState<number | null>(null);
  const [view, setView] = useState(() => visibleWindow(rows.length, periodRange(prices, period)));
  const [band, setBand] = useState<{ left: number; width: number } | null>(null);
  const [docked, setDocked] = useState(false);
  const wrap = useRef<HTMLDivElement>(null),
    host = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi | null>(null),
    priceSeries = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Area'> | null>(null);
  const latest = useRef({ selection, period, select });
  latest.current = { selection, period, select };
  const savedRange = useRef<IRange<number> | null>(null);
  const redraw = useRef(() => {});
  const drag = useRef<number | null>(null);
  const heights = useMemo(
    () => paneHeights[narrow ? 'narrow' : 'wide'].slice(0, withTotal ? 4 : 3),
    [narrow, withTotal],
  );
  const height = heights.reduce((sum, h) => sum + h, AXIS_HEIGHT + heights.length - 1);

  useEffect(() => {
    const element = host.current;
    if (!element || !rows.length) return;
    const api = publicChart(element);
    chart.current = api;
    const time = api.timeScale();
    const index = new Map(rows.map((row, i) => [row.date, i]));
    const dates = rows.map((row) => row.date);
    const { price, cumulative } = addPanes(api, rows, type, heights);
    priceSeries.current = price;
    createSeriesMarkers(
      price,
      marks.map((mark) => ({
        id: mark.date,
        time: mark.date,
        size: 0.6,
        ...markStyle[mark.kind],
      })),
    );
    api.subscribeClick((event) => {
      const day = typeof event.hoveredObjectId === 'string' ? event.hoveredObjectId : null;
      if (day) latest.current.select({ anchor: day, end: day });
    });

    redraw.current = () => {
      const selected = selectedRows(dates, latest.current.selection);
      const at = (i: number) => time.logicalToCoordinate(i as Logical);
      const left = selected && at(selected.first),
        right = selected && at(selected.last),
        next = selected && at(selected.first + 1);
      if (left == null || right == null || next == null) return setBand(null);
      const half = (next - left) / 2;
      const from = Math.max(0, left - half),
        to = Math.min(time.width(), right + half);
      setBand(to > from ? { left: from, width: to - from } : null);
    };
    let shown = '';
    const sync = (range: IRange<number> | null) => {
      const next = visibleWindow(rows.length, range);
      const key = next ? `${next.first}:${next.last}` : '';
      if (key !== shown) {
        shown = key;
        cumulative?.setData(next ? cumulativeData(prices, next) : []);
        setView(next);
      }
      redraw.current();
    };
    time.subscribeVisibleLogicalRangeChange(sync);
    time.subscribeSizeChange(() => redraw.current());
    api.subscribeCrosshairMove((event) =>
      setHover(event.time === undefined ? null : (index.get(chartDate(event.time) ?? '') ?? null)),
    );
    const initial = savedRange.current ?? periodRange(prices, latest.current.period);
    sync(initial);
    // The chart only knows its plot width after the first layout.
    let fitted = false;
    const frame = requestAnimationFrame(() => {
      time.setVisibleLogicalRange(initial);
      fitted = true;
    });
    return () => {
      cancelAnimationFrame(frame);
      if (fitted) savedRange.current = time.getVisibleLogicalRange();
      redraw.current = () => {};
      chart.current = null;
      priceSeries.current = null;
      api.remove();
    };
  }, [rows, prices, type, heights, marks]);

  useEffect(() => {
    redraw.current();
  }, [selection]);

  const first = view && prices[view.first],
    last = view && prices[view.last];
  const periodChange = first?.close && last ? (last.close / first.close - 1) * 100 : 0;
  const windowTone = toneOf(periodChange);
  useEffect(() => {
    if (type === 'line') priceSeries.current?.applyOptions(areaColors(windowTone));
  }, [type, windowTone, rows, heights]);

  useEffect(() => {
    const scroll = () => setDocked((wrap.current?.getBoundingClientRect().bottom ?? 1) <= 0);
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
      if (!selection || !['Escape', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      select(
        selectionKey(
          selection,
          prices.map((p) => p.date),
          e.key,
          e.shiftKey,
        ),
      );
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [selection, prices, select]);

  function choosePeriod(next: Period) {
    setPeriod(next);
    chart.current?.timeScale().setVisibleLogicalRange(periodRange(prices, next));
  }
  function chooseType(next: ChartType) {
    setType(next);
    writeStorage(typeKey, next);
  }
  function rowAt(event: PointerEvent<HTMLDivElement>) {
    const rect = wrap.current?.getBoundingClientRect();
    const logical =
      rect && chart.current?.timeScale().coordinateToLogical(event.clientX - rect.left);
    return logical == null
      ? undefined
      : Math.max(0, Math.min(rows.length - 1, Math.round(logical)));
  }
  function start(event: PointerEvent<HTMLDivElement>) {
    const rect = wrap.current?.getBoundingClientRect(),
      api = chart.current;
    if (!rect || !api || event.button !== 0) return;
    const onAxis = event.target instanceof Element && event.target.closest('.chart-axis') !== null;
    const shiftDrag =
      event.shiftKey &&
      event.pointerType === 'mouse' &&
      event.clientX - rect.left <= api.timeScale().width();
    const index = onAxis || shiftDrag ? rowAt(event) : undefined;
    const day = index === undefined ? undefined : rows[index]?.date;
    if (index === undefined || !day) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = index;
    select({ anchor: day, end: day });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const anchor = drag.current === null ? undefined : rows[drag.current]?.date;
    const index = anchor === undefined ? undefined : rowAt(event);
    const end = index === undefined ? undefined : rows[index]?.date;
    if (anchor !== undefined && end !== undefined) select({ anchor, end });
  }
  function finish() {
    drag.current = null;
  }

  const shown = hover === null ? undefined : rows[hover];
  const previous = hover === null ? undefined : rows[hover - 1];
  const change = shown && previous ? shown.close - previous.close : null;
  if (!rows.length)
    return (
      <section className="section" aria-label="Price and volume">
        <p className="empty-state">No price data</p>
      </section>
    );
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
      <section className="section" id="price-section" aria-label="Price and volume">
        <div className="chart-controls">
          <div className="ranges" aria-label="Chart period">
            {periods.map((p) => (
              <button
                key={p}
                data-range={p}
                aria-pressed={p === period}
                onClick={() => choosePeriod(p)}
              >
                {p}
              </button>
            ))}
          </div>
          {first && last && (
            <strong
              className={`period-change ${direction(periodChange)}`}
              title={`${dateText(first.date)} – ${dateText(last.date)}`}
            >
              {signed(periodChange, (v) => nf(v, 2))}%
            </strong>
          )}
          {narrow ? (
            <button
              type="button"
              className="chart-type-switch"
              data-type={type === 'line' ? 'candles' : 'line'}
              onClick={() => chooseType(type === 'line' ? 'candles' : 'line')}
            >
              {chartTypes[type === 'line' ? 'candles' : 'line']}
            </button>
          ) : (
            <div className="ranges chart-type" aria-label="Chart type">
              {(Object.keys(chartTypes) as ChartType[]).map((t) => (
                <button
                  key={t}
                  data-type={t}
                  aria-pressed={t === type}
                  onClick={() => chooseType(t)}
                >
                  {chartTypes[t]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          className="price-chart"
          ref={wrap}
          style={{ height }}
          onPointerLeave={(event) => event.pointerType === 'mouse' && setHover(null)}
          onPointerDownCapture={start}
          onMouseDownCapture={(event) => {
            if (drag.current !== null) event.stopPropagation();
          }}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
        >
          <div
            className="chart-host"
            ref={host}
            role="img"
            aria-label={`${ticker} price, volume, net foreign flow and cumulative foreign flow`}
            data-series={type}
            data-bars={rows.length}
          />
          {shown && (
            <div className="readout" role="status">
              <time className="readout-date" dateTime={shown.date}>
                {dateText(shown.date)}
              </time>
              <span className={`readout-change ${direction(change)}`}>
                {change === null || !previous?.close
                  ? '—'
                  : `${signed(change, nf)} (${signed((change / previous.close) * 100, (v) => nf(v, 2))}%)`}
              </span>
              {type === 'candles' && (
                <>
                  <span>
                    <i>O</i>
                    {nf(shown.open)}
                  </span>
                  <span>
                    <i>H</i>
                    {nf(shown.high)}
                  </span>
                  <span>
                    <i>L</i>
                    {nf(shown.low)}
                  </span>
                </>
              )}
              <span>
                <i>C</i>
                {nf(shown.close)}
              </span>
              {shown.volume === 0 ? (
                <span className="readout-status">Suspended</span>
              ) : (
                <>
                  <span className="readout-volume" title={`${nf(shown.volume)} shares`}>
                    <i>Volume</i>
                    {short(shown.volume)}
                  </span>
                  <span
                    className={`readout-foreign ${direction(shown.netForeign)}`}
                    title={`${signed(shown.netForeign, nf)} IDR`}
                  >
                    <i>Net foreign</i>
                    {signed(shown.netForeign)}
                  </span>
                </>
              )}
              {shown.estimated && (
                <span
                  className="readout-status"
                  title="Missing open, high or low values use the close. The traded range is unavailable."
                >
                  Est.
                </span>
              )}
            </div>
          )}
          {band && <div className="selection-band" style={band} />}
          <div className="chart-axis" />
        </div>
        <div className="chart-foot">
          {narrow && (
            <button
              type="button"
              className="pane-toggle"
              aria-pressed={totalOpen}
              onClick={() => setTotalOpen(!totalOpen)}
            >
              Cumulative foreign
            </button>
          )}
          <span className="chart-selection">
            <SelectionLabel prices={prices} selection={selection} />
          </span>
          <ChartAttribution />
        </div>
        {children}
      </section>
    </>
  );
}
