import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { AreaSeries, CandlestickSeries, HistogramSeries, type IChartApi } from 'lightweight-charts';
import type { Ticker } from '../data';
import { nf, short, dateText, signed } from '../ticker/format';
import { bounds } from '../ticker/logic';
import { useTerminal } from './state';
import { Availability, Segments, Empty } from './ui';
import { terminalChart, chartDate } from './charts';
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
export function PricePane() {
  const { detail, range, setRange, ticker } = useTerminal();
  return (
    <>
      <div className="sub">
        <Segments
          label="Chart range"
          values={['1M', '3M', '6M', 'YTD']}
          value={range}
          onChange={setRange}
        />
      </div>
      <Availability resource={detail} name="Price history">
        {(data) =>
          data.prices.length ? (
            <PriceHistory key={ticker} data={data} />
          ) : (
            <Empty>No price history</Empty>
          )
        }
      </Availability>
    </>
  );
}
function PriceHistory({ data }: { data: Ticker }) {
  const { range, selection, select } = useTerminal();
  const host = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi | null>(null);
  const current = useRef({ selection, select });
  current.current = { selection, select };
  const drag = useRef<{ anchor: string; end: string } | null>(null);
  const [hover, setHover] = useState(data.prices.at(-1));
  const [band, setBand] = useState<{ left: number; width: number } | null>(null);
  const [candles, setCandles] = useState(false);
  const redraw = useRef<() => void>(() => {});
  useEffect(() => {
    if (!host.current) return;
    const api = terminalChart(host.current);
    chart.current = api;
    const area = api.addSeries(AreaSeries, {
      lineColor: '#d9ded8',
      lineWidth: 2,
      topColor: '#d9ded820',
      bottomColor: '#d9ded800',
      priceFormat: { type: 'custom', minMove: 1, formatter: (value: number) => nf(value) },
    });
    area.setData(data.prices.map((p) => ({ time: p.date, value: p.close })));
    const candle = api.addSeries(CandlestickSeries, {
      upColor: '#22a6a0',
      downColor: '#e4573f',
      borderVisible: false,
      wickUpColor: '#22a6a0',
      wickDownColor: '#e4573f',
      visible: false,
    });
    candle.setData(
      data.prices.map((p) =>
        p.open !== null && p.high !== null && p.low !== null
          ? { time: p.date, open: p.open, high: p.high, low: p.low, close: p.close }
          : { time: p.date },
      ),
    );
    const volume = api.addSeries(
      HistogramSeries,
      {
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat: { type: 'custom', formatter: short },
      },
      1,
    );
    volume.setData(
      data.prices.map((p, i) => ({
        time: p.date,
        value: p.volume / 100,
        color: p.close >= (data.prices[i - 1]?.close ?? p.close) ? '#22a6a08c' : '#e4573f8c',
      })),
    );
    const foreign = api.addSeries(
      HistogramSeries,
      {
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat: { type: 'custom', formatter: short },
      },
      2,
    );
    foreign.setData(
      data.prices.map((p) => ({
        time: p.date,
        value: p.net_foreign,
        color: p.net_foreign >= 0 ? '#22a6a0' : '#e4573f',
      })),
    );
    api.panes().forEach((pane, i) => pane.setStretchFactor(i === 0 ? 4 : 1));
    redraw.current = () => {
      const b = bounds(current.current.selection);
      const a = b && api.timeScale().timeToCoordinate(b.start),
        z = b && api.timeScale().timeToCoordinate(b.end);
      setBand(
        a == null || z == null ? null : { left: Math.max(0, a - 3), width: Math.max(6, z - a + 6) },
      );
    };
    api.timeScale().subscribeVisibleLogicalRangeChange((visible) => {
      if (!visible) return;
      const rows = data.prices
        .slice(Math.max(0, Math.floor(visible.from)), Math.ceil(visible.to) + 1)
        .filter((p) => p.volume > 0);
      const complete =
        rows.length > 0 && rows.every((p) => p.open !== null && p.high !== null && p.low !== null);
      candle.applyOptions({ visible: complete });
      area.applyOptions({ visible: !complete });
      setCandles(complete);
      redraw.current();
    });
    api.timeScale().subscribeSizeChange(() => redraw.current());
    api.subscribeCrosshairMove((event) => {
      const date = chartDate(event.time);
      setHover(data.prices.find((p) => p.date === date) ?? data.prices.at(-1));
    });
    return () => {
      chart.current = null;
      api.remove();
    };
  }, [data]);
  useEffect(() => {
    const api = chart.current,
      last = data.prices.at(-1);
    if (!api || !last) return;
    const count =
      range === 'YTD'
        ? data.prices.filter((p) => p.date.slice(0, 4) === last.date.slice(0, 4)).length
        : { '1M': 21, '3M': 63, '6M': 126 }[range];
    api.timeScale().setVisibleLogicalRange({
      from: Math.max(0, data.prices.length - count),
      to: data.prices.length + 3,
    });
  }, [range, data]);
  useEffect(() => {
    redraw.current();
  }, [selection]);
  function dateAt(event: PointerEvent<HTMLDivElement>) {
    const rect = host.current?.getBoundingClientRect(),
      api = chart.current;
    if (!rect || !api) return undefined;
    const logical = api.timeScale().coordinateToLogical(event.clientX - rect.left);
    return logical === null
      ? undefined
      : data.prices[Math.max(0, Math.min(data.prices.length - 1, Math.round(logical)))]?.date;
  }
  function start(event: PointerEvent<HTMLDivElement>) {
    const api = chart.current,
      rect = host.current?.getBoundingClientRect();
    if (!api || !rect || event.button !== 0 || event.clientX - rect.left > api.timeScale().width())
      return;
    if (!event.shiftKey && event.clientY - rect.top < rect.height - api.timeScale().height())
      return;
    const date = dateAt(event);
    if (!date) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = { anchor: date, end: date };
    select({ anchor: date, end: date });
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
            <time>{dateText(hover.date)}</time>
            {candles && (
              <>
                <span>O {nf(hover.open ?? 0)}</span>
                <span>H {nf(hover.high ?? 0)}</span>
                <span>L {nf(hover.low ?? 0)}</span>
              </>
            )}
            <span>C {nf(hover.close)} IDR</span>
            <span>LOT {short(hover.volume / 100)}</span>
            <span>F NET EST. {signed(hover.net_foreign, short)} IDR</span>
          </>
        )}
      </div>
      <div
        className="price-chart-wrap"
        onPointerDownCapture={start}
        onMouseDownCapture={(e) => {
          if (drag.current) e.stopPropagation();
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            const date = dateAt(e);
            if (date) {
              drag.current.end = date;
              select({ anchor: drag.current.anchor, end: date });
            }
          }
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <div className="chart-host" ref={host} data-series={candles ? 'candles' : 'area'} />
        {band && <div className="selection-band" style={band} />}
      </div>
      <div className="chart-foot">
        <span>
          {b && (
            <>
              {b.start} to {b.end}{' '}
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
