import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  TickMarkType,
  type IChartApi,
  type LogicalRange,
  type Time,
} from 'lightweight-charts';
import type { Ticker } from '../data';
import { nf, short, dateText } from '../ticker/format';
import { bounds } from '../ticker/logic';
import { readStorage, writeStorage } from '../watchlist';
import { useTerminal } from './state';
import { Availability, Segments, Empty, SignInPrompt } from './ui';
import {
  terminalChart,
  chartDate,
  dailyBars,
  weeklyBars,
  intradayBars,
  type PriceBar,
} from './charts';
import { useTradeSessions } from './tick-data';
import { ChartAttribution as Attribution } from '../ChartAttribution';
import './charts.css';

const chartTypes = ['CANDLE', 'LINE'] as const;
type ChartType = (typeof chartTypes)[number];
function chartGlyph(type: ChartType) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      {type === 'CANDLE' ? (
        <>
          <path d="M4 1v3m0 6v5M12 1v5m0 6v3" />
          <path d="M2 4h4v6H2zM10 6h4v6h-4z" />
        </>
      ) : (
        <path d="m1 13 4-5 4 2 6-8" />
      )}
    </svg>
  );
}
function useChartSetting<T extends string>(key: string, values: readonly T[], fallback: T) {
  const [value, setValue] = useState(() => {
    const saved = readStorage(key);
    return values.find((option) => option === saved) ?? fallback;
  });
  function change(next: T) {
    setValue(next);
    writeStorage(key, next);
  }
  return [value, change] as const;
}
const intraday = {
  '4H': { minutes: 240, sessions: 20 },
  '1H': { minutes: 60, sessions: 10 },
  '15M': { minutes: 15, sessions: 5 },
};

export function PricePane() {
  const { detail, timeframe, setTimeframe, ticker, session } = useTerminal();
  const [chartType, setChartType] = useChartSetting('terminal:chart:type', chartTypes, 'CANDLE');
  return (
    <>
      <div className="sub chart-controls">
        <Segments
          label="Chart timeframe"
          values={['W', 'D', '4H', '1H', '15M']}
          value={timeframe}
          onChange={setTimeframe}
        />
        <Segments
          label="Chart type"
          values={chartTypes}
          value={chartType}
          onChange={setChartType}
          renderOption={chartGlyph}
          optionLabel={(type) => (type === 'CANDLE' ? 'Candlestick' : 'Line')}
        />
      </div>
      {timeframe !== 'D' && timeframe !== 'W' && session !== 'signed-in' ? (
        <SignInPrompt />
      ) : (
        <Availability resource={detail} name="Price history">
          {(data) =>
            timeframe === 'D' || timeframe === 'W' ? (
              <DailyHistory
                key={`${ticker}:${timeframe}`}
                data={data}
                chartType={chartType}
                weekly={timeframe === 'W'}
              />
            ) : (
              <IntradayHistory
                key={`${ticker}:${timeframe}`}
                chartType={chartType}
                {...intraday[timeframe]}
              />
            )
          }
        </Availability>
      )}
    </>
  );
}

function DailyHistory({
  data,
  chartType,
  weekly,
}: {
  data: Ticker;
  chartType: ChartType;
  weekly: boolean;
}) {
  const series = useMemo(
    () => (weekly ? weeklyBars(data.prices) : dailyBars(data.prices)),
    [data, weekly],
  );
  return series.length ? (
    <PriceHistory data={series} chartType={chartType} visibleBars={weekly ? 52 : 126} />
  ) : (
    <Empty>No price history</Empty>
  );
}
function IntradayHistory({
  chartType,
  minutes,
  sessions,
}: {
  chartType: ChartType;
  minutes: number;
  sessions: number;
}) {
  const { state, loadMore } = useTradeSessions(sessions);
  const series = useMemo(
    () => (state.kind === 'ready' ? intradayBars(state.data, minutes) : []),
    [state, minutes],
  );
  if (state.kind === 'loading') return <Empty>Loading trades…</Empty>;
  if (state.kind === 'error')
    return (
      <p className="empty" role="alert">
        {state.message}
      </p>
    );
  return series.length ? (
    <PriceHistory data={series} chartType={chartType} loadMore={loadMore} />
  ) : (
    <Empty>No collected regular-board trades</Empty>
  );
}

const wibClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const wibDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  day: 'numeric',
  month: 'short',
});
function barTime(time: Time) {
  return typeof time === 'number'
    ? `${dateText(chartDate(time)!)} ${wibClock.format(time * 1000)} WIB`
    : dateText(chartDate(time)!);
}

function PriceHistory({
  data,
  chartType,
  visibleBars = data.length,
  loadMore,
}: {
  data: PriceBar[];
  chartType: ChartType;
  visibleBars?: number;
  loadMore?: () => void;
}) {
  const { selection, select } = useTerminal();
  const host = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi | null>(null);
  const current = useRef({ selection, select, data, visibleBars, loadMore });
  current.current = { selection, select, data, visibleBars, loadMore };
  const drag = useRef<PriceBar | null>(null);
  const visibleRange = useRef<LogicalRange | null>(null);
  const [hoverTime, setHoverTime] = useState<Time | null>(null);
  const hover = data.find((bar) => bar.time === hoverTime) ?? data.at(-1);
  const [band, setBand] = useState<{ left: number; width: number } | null>(null);
  const redraw = useRef<() => void>(() => {});
  const updateData = useRef<(data: PriceBar[]) => void>(() => {});
  useEffect(() => {
    if (!host.current) return;
    const { data, visibleBars } = current.current;
    const api = terminalChart(host.current);
    api.timeScale().applyOptions({ lockVisibleTimeRangeOnResize: true });
    if (typeof data[0]?.time === 'number') {
      api.applyOptions({
        localization: { timeFormatter: barTime },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          tickMarkFormatter: (time: Time, type: TickMarkType) =>
            typeof time === 'number'
              ? (type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds
                  ? wibClock
                  : wibDate
                ).format(time * 1000)
              : chartDate(time),
        },
      });
    }
    chart.current = api;
    const priceFormat = {
      type: 'custom',
      minMove: 1,
      formatter: (value: number) => nf(value),
    } as const;
    const price =
      chartType === 'CANDLE'
        ? api.addSeries(CandlestickSeries, {
            upColor: '#22a6a0',
            downColor: '#e4573f',
            borderVisible: false,
            wickUpColor: '#22a6a0',
            wickDownColor: '#e4573f',
            priceFormat,
          })
        : api.addSeries(LineSeries, { color: '#d9ded8', lineWidth: 2, priceFormat });
    price.priceScale().applyOptions({
      scaleMargins: { top: 0.08, bottom: 0.28 },
    });
    const volume = api.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
      priceFormat: { type: 'custom', formatter: short },
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    redraw.current = () => {
      const b = bounds(current.current.selection);
      const selected = b
        ? current.current.data.filter((bar) => bar.date <= b.end && bar.endDate >= b.start)
        : [];
      const first = selected[0],
        last = selected.at(-1);
      const a = first && api.timeScale().timeToCoordinate(first.time),
        z = last && api.timeScale().timeToCoordinate(last.time);
      setBand(
        a == null || z == null ? null : { left: Math.max(0, a - 3), width: Math.max(6, z - a + 6) },
      );
    };
    let fitted = false;
    let updating = false;
    let previousRange: LogicalRange | null = null;
    api.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      redraw.current();
      if (
        fitted &&
        !updating &&
        range &&
        previousRange &&
        range.from < previousRange.from &&
        range.from <= 5
      )
        current.current.loadMore?.();
      previousRange = range;
    });
    api.timeScale().subscribeSizeChange(() => redraw.current());
    api.subscribeCrosshairMove((event) => {
      const bar = current.current.data.find((bar) =>
        typeof event.time === 'number'
          ? bar.time === event.time
          : bar.date === chartDate(event.time),
      );
      setHoverTime(bar?.time ?? null);
    });
    let previous: PriceBar[] = [];
    updateData.current = (data) => {
      const range = api.timeScale().getVisibleLogicalRange();
      const added = previous.length ? data.findIndex((bar) => bar.time === previous[0]?.time) : 0;
      updating = true;
      price.setData(
        data.map((bar) => ({
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          value: bar.close,
        })),
      );
      volume.setData(
        data.map((bar) => ({
          time: bar.time,
          value: bar.volume / 100,
          color: bar.close >= bar.open ? '#22a6a08c' : '#e4573f8c',
        })),
      );
      if (range && previous.length && added >= 0)
        api.timeScale().setVisibleLogicalRange({ from: range.from + added, to: range.to + added });
      previous = data;
      previousRange = api.timeScale().getVisibleLogicalRange();
      updating = false;
      redraw.current();
    };
    // Fit after the first layout, when the chart knows its pane and price-axis widths.
    const frame = requestAnimationFrame(() => {
      if (visibleRange.current) api.timeScale().setVisibleLogicalRange(visibleRange.current);
      else
        api.timeScale().applyOptions({
          barSpacing: api.timeScale().width() / Math.min(data.length, visibleBars),
          rightOffsetPixels: 6,
        });
      fitted = true;
    });
    return () => {
      cancelAnimationFrame(frame);
      if (fitted) visibleRange.current = api.timeScale().getVisibleLogicalRange();
      redraw.current = () => {};
      chart.current = null;
      updateData.current = () => {};
      api.remove();
    };
  }, [chartType]);
  useEffect(() => {
    updateData.current(data);
  }, [data, chartType]);
  useEffect(() => {
    redraw.current();
  }, [selection]);
  function barAt(event: PointerEvent<HTMLDivElement>) {
    const rect = host.current?.getBoundingClientRect(),
      api = chart.current;
    if (!rect || !api) return undefined;
    const logical = api.timeScale().coordinateToLogical(event.clientX - rect.left);
    return logical === null
      ? undefined
      : data[Math.max(0, Math.min(data.length - 1, Math.round(logical)))];
  }
  function start(event: PointerEvent<HTMLDivElement>) {
    const api = chart.current,
      rect = host.current?.getBoundingClientRect();
    if (!api || !rect || event.button !== 0 || event.clientX - rect.left > api.timeScale().width())
      return;
    if (!event.shiftKey && event.clientY - rect.top < rect.height - api.timeScale().height())
      return;
    const bar = barAt(event);
    if (!bar) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = bar;
    select({ anchor: bar.date, end: bar.endDate });
    api.applyOptions({ handleScroll: false, handleScale: false });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function finish() {
    drag.current = null;
    chart.current?.applyOptions({ handleScroll: true, handleScale: true });
  }
  const b = bounds(selection);
  return (
    <div className="price-view">
      <div className="legend">
        {hover && (
          <>
            <time>
              {barTime(hover.time)}
              {hover.endDate !== hover.date && ` to ${dateText(hover.endDate)}`}
            </time>
            {chartType === 'CANDLE' && (
              <span
                className="chart-ohlc"
                title={
                  hover.estimated
                    ? 'Missing OHLC values use the close. The full traded range is unavailable.'
                    : undefined
                }
              >
                <span>O {nf(hover.open)}</span>
                <span>H {nf(hover.high)}</span>
                <span>L {nf(hover.low)}</span>
                {hover.estimated && <span>EST.</span>}
              </span>
            )}
            <span>C {nf(hover.close)} IDR</span>
            <span>LOT {short(hover.volume / 100)}</span>
          </>
        )}
      </div>
      <div
        className="price-chart-wrap"
        onPointerLeave={() => setHoverTime(null)}
        onPointerDownCapture={start}
        onMouseDownCapture={(event) => {
          if (drag.current) event.stopPropagation();
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const bar = barAt(event);
          if (bar)
            select({
              anchor: bar.date < drag.current.date ? bar.date : drag.current.date,
              end: bar.endDate > drag.current.endDate ? bar.endDate : drag.current.endDate,
            });
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <div
          className="chart-host"
          ref={host}
          role="img"
          aria-label="Price history in IDR"
          data-series={chartType === 'CANDLE' ? 'candles' : 'line'}
          data-bars={data.length}
        />
        {band && <div className="selection-band" style={band} />}
      </div>
      <div className="chart-foot">
        <span>
          {b && (
            <>
              {dateText(b.start)} to {dateText(b.end)}{' '}
              <button aria-label="Clear chart range" onClick={() => select(null)}>
                ×
              </button>
            </>
          )}
        </span>
        <Attribution />
      </div>
    </div>
  );
}
