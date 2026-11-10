import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  TickMarkType,
  createTextWatermark,
  type IChartApi,
  type LogicalRange,
  type Time,
} from 'lightweight-charts';
import type { Ticker } from '../data';
import { nf, short, dateText, signed } from '../ticker/format';
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
import './charts.css';

export function Attribution() {
  return (
    <a
      className="chart-attribution"
      href="https://www.tradingview.com/"
      target="_blank"
      rel="noreferrer"
      title="TradingView Lightweight Charts™ Copyright (c) 2025 TradingView, Inc."
    >
      TradingView
    </a>
  );
}

const chartTypes = ['CANDLE', 'LINE'] as const;
const volumeModes = ['OFF', 'OVERLAY', 'PANE'] as const;
const foreignModes = ['OFF', 'ON'] as const;
type ChartSettings = {
  chartType: (typeof chartTypes)[number];
  volumeMode: (typeof volumeModes)[number];
  foreignMode: (typeof foreignModes)[number];
};
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
  const [volumeMode, setVolumeMode] = useChartSetting('terminal:chart:volume', volumeModes, 'PANE');
  const [foreignMode, setForeignMode] = useChartSetting(
    'terminal:chart:foreign',
    foreignModes,
    'ON',
  );
  const settings = { chartType, volumeMode, foreignMode };
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
        />
        <div className="chart-option">
          <span>VOL</span>
          <Segments
            label="Chart volume"
            values={volumeModes}
            value={volumeMode}
            onChange={setVolumeMode}
          />
        </div>
        <div className="chart-option">
          <span>FGN</span>
          <Segments
            label="Chart foreign net"
            values={foreignModes}
            value={foreignMode}
            onChange={setForeignMode}
          />
        </div>
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
                settings={settings}
                weekly={timeframe === 'W'}
              />
            ) : (
              <IntradayHistory
                key={`${ticker}:${timeframe}`}
                settings={settings}
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
  settings,
  weekly,
}: {
  data: Ticker;
  settings: ChartSettings;
  weekly: boolean;
}) {
  const series = useMemo(
    () => (weekly ? weeklyBars(data.prices) : dailyBars(data.prices)),
    [data, weekly],
  );
  return series.length ? (
    <PriceHistory data={series} settings={settings} visibleBars={weekly ? 52 : 126} />
  ) : (
    <Empty>No price history</Empty>
  );
}
function IntradayHistory({
  settings,
  minutes,
  sessions,
}: {
  settings: ChartSettings;
  minutes: number;
  sessions: number;
}) {
  const state = useTradeSessions(sessions);
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
    <PriceHistory data={series} settings={settings} />
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
  settings: { chartType, volumeMode, foreignMode },
  visibleBars = data.length,
}: {
  data: PriceBar[];
  settings: ChartSettings;
  visibleBars?: number;
}) {
  const { selection, select } = useTerminal();
  const host = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi | null>(null);
  const current = useRef({ selection, select });
  current.current = { selection, select };
  const drag = useRef<PriceBar | null>(null);
  const visibleRange = useRef<LogicalRange | null>(null);
  const [hoverTime, setHoverTime] = useState<Time | null>(null);
  const hover = data.find((bar) => bar.time === hoverTime) ?? data.at(-1);
  const [band, setBand] = useState<{ left: number; width: number } | null>(null);
  const redraw = useRef<() => void>(() => {});
  useEffect(() => {
    if (!host.current) return;
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
    price.priceScale().applyOptions({
      scaleMargins: { top: 0.08, bottom: volumeMode === 'OVERLAY' ? 0.28 : 0.08 },
    });
    let paneIndex = 1;
    function label(index: number, text: string) {
      createTextWatermark(api.panes()[index]!, {
        horzAlign: 'left',
        vertAlign: 'top',
        lines: [{ text, color: '#8d9790', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }],
      });
    }
    if (volumeMode !== 'OFF') {
      const index = volumeMode === 'PANE' ? paneIndex++ : 0;
      const volume = api.addSeries(
        HistogramSeries,
        {
          priceScaleId: volumeMode === 'OVERLAY' ? 'volume' : 'right',
          lastValueVisible: false,
          priceLineVisible: false,
          priceFormat: { type: 'custom', formatter: short },
        },
        index,
      );
      volume.setData(
        data.map((bar) => ({
          time: bar.time,
          value: bar.volume / 100,
          color: bar.close >= bar.open ? '#22a6a08c' : '#e4573f8c',
        })),
      );
      if (volumeMode === 'OVERLAY')
        volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      else label(index, 'VOLUME LOT');
    }
    if (foreignMode === 'ON') {
      const index = paneIndex++;
      api
        .addSeries(
          HistogramSeries,
          {
            lastValueVisible: false,
            priceLineVisible: false,
            priceFormat: { type: 'custom', formatter: short },
          },
          index,
        )
        .setData(
          data.map((bar) => ({
            time: bar.time,
            value: bar.net_foreign,
            color: bar.net_foreign >= 0 ? '#22a6a0' : '#e4573f',
          })),
        );
      label(index, typeof data[0]?.time === 'number' ? 'FOREIGN NET IDR' : 'FOREIGN NET EST. IDR');
    }
    api.panes().forEach((pane, i) => pane.setStretchFactor(i === 0 ? 4 : 1));
    redraw.current = () => {
      const b = bounds(current.current.selection);
      const selected = b ? data.filter((bar) => bar.date <= b.end && bar.endDate >= b.start) : [];
      const first = selected[0],
        last = selected.at(-1);
      const a = first && api.timeScale().timeToCoordinate(first.time),
        z = last && api.timeScale().timeToCoordinate(last.time);
      setBand(
        a == null || z == null ? null : { left: Math.max(0, a - 3), width: Math.max(6, z - a + 6) },
      );
    };
    api.timeScale().subscribeVisibleLogicalRangeChange(() => redraw.current());
    api.timeScale().subscribeSizeChange(() => redraw.current());
    api.subscribeCrosshairMove((event) => {
      const bar = data.find((bar) =>
        typeof event.time === 'number'
          ? bar.time === event.time
          : bar.date === chartDate(event.time),
      );
      setHoverTime(bar?.time ?? null);
    });
    // Fit after the first layout, when the chart knows its pane and price-axis widths.
    let fitted = false;
    const frame = requestAnimationFrame(() => {
      api.timeScale().setVisibleLogicalRange(
        visibleRange.current ?? {
          from: Math.max(0, data.length - visibleBars),
          to: data.length + 3,
        },
      );
      fitted = true;
    });
    return () => {
      cancelAnimationFrame(frame);
      if (fitted) visibleRange.current = api.timeScale().getVisibleLogicalRange();
      redraw.current = () => {};
      chart.current = null;
      api.remove();
    };
  }, [data, chartType, volumeMode, foreignMode, visibleBars]);
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
            {volumeMode !== 'OFF' && <span>LOT {short(hover.volume / 100)}</span>}
            {foreignMode === 'ON' && (
              <span>
                F NET {typeof hover.time !== 'number' && 'EST. '}
                {signed(hover.net_foreign, short)} IDR
              </span>
            )}
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
          data-volume={volumeMode}
          data-foreign={foreignMode}
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
