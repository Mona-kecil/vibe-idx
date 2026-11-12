import type { Ticker } from '../data';
import { chartTheme } from '../ticker/chartTheme';
import { dateText } from '../ticker/format';
import { bars, type TickTrades } from '../ticks';
import {
  ColorType,
  CrosshairMode,
  TrackingModeExitMode,
  LineStyle,
  createChart,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
export function terminalChart(host: HTMLElement) {
  return createChart(host, {
    autoSize: true,
    layout: {
      attributionLogo: false,
      background: { type: ColorType.Solid, color: '#101312' },
      textColor: '#8d9790',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      panes: { separatorColor: '#222826', separatorHoverColor: '#d6b25e', enableResize: true },
    },
    grid: { vertLines: { color: '#151a18' }, horzLines: { color: '#151a18' } },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#5b6560', labelBackgroundColor: '#232a27' },
      horzLine: { color: '#5b6560', labelBackgroundColor: '#232a27' },
    },
    rightPriceScale: { borderColor: '#222826', entireTextOnly: true },
    timeScale: { borderColor: '#222826', rightOffset: 4 },
  });
}

export function publicChart(host: HTMLElement) {
  const label = { color: chartTheme.ink, labelBackgroundColor: chartTheme.ink };
  return createChart(host, {
    autoSize: true,
    layout: {
      attributionLogo: false,
      background: { type: ColorType.Solid, color: chartTheme.surface },
      textColor: chartTheme.text,
      fontFamily: chartTheme.font,
      fontSize: 11,
      panes: {
        separatorColor: chartTheme.line,
        separatorHoverColor: chartTheme.line,
        enableResize: false,
      },
    },
    grid: {
      vertLines: { color: chartTheme.grid },
      horzLines: { color: chartTheme.grid },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { ...label, style: LineStyle.Dashed },
      horzLine: { ...label, style: LineStyle.Dashed },
    },
    trackingMode: { exitMode: TrackingModeExitMode.OnTouchEnd },
    rightPriceScale: { borderVisible: false, entireTextOnly: true },
    timeScale: {
      borderColor: chartTheme.line,
      fixLeftEdge: true,
      lockVisibleTimeRangeOnResize: true,
    },
    localization: { timeFormatter: (time: Time) => dateText(chartDate(time)!) },
    // Wheel scrolls the page, a vertical swipe scrolls the page, and the time axis is
    // reserved for range selection.
    handleScale: { mouseWheel: false, axisPressedMouseMove: { time: false, price: true } },
    handleScroll: { vertTouchDrag: false },
  });
}

export function chartDate(time: Time | undefined) {
  return typeof time === 'number'
    ? new Date((time + 7 * 3600) * 1000).toISOString().slice(0, 10)
    : typeof time === 'string'
      ? time
      : typeof time === 'object'
        ? `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`
        : null;
}

export type PriceBar = Omit<Ticker['prices'][number], 'open' | 'high' | 'low' | 'net_foreign'> & {
  time: Time;
  endDate: string;
  open: number;
  high: number;
  low: number;
  estimated: boolean;
};

export function dailyBars(prices: Ticker['prices']): PriceBar[] {
  return prices.map(({ net_foreign: _, ...price }) => {
    // Missing OHLC cannot describe the day's range; use the close without inventing a move.
    const open = price.open ?? price.close;
    return {
      ...price,
      time: price.date,
      endDate: price.date,
      open,
      high: Math.max(price.high ?? price.close, open, price.close),
      low: Math.min(price.low ?? price.close, open, price.close),
      estimated: price.open === null || price.high === null || price.low === null,
    };
  });
}

export function weeklyBars(prices: Ticker['prices']): PriceBar[] {
  const weeks = new Map<string, PriceBar>();
  for (const price of dailyBars(prices)) {
    const monday = new Date(`${price.date}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    const week = weeks.get(key);
    if (!week) weeks.set(key, { ...price });
    else {
      week.high = Math.max(week.high, price.high);
      week.low = Math.min(week.low, price.low);
      week.close = price.close;
      week.endDate = price.date;
      week.volume += price.volume;
      week.value += price.value;
      week.estimated ||= price.estimated;
    }
  }
  return [...weeks.values()];
}

export function intradayBars(sessions: TickTrades[], minutes: number): PriceBar[] {
  return sessions
    .flatMap((trades) => {
      const values = new Map<number, number>();
      trades.time.forEach((time, i) => {
        if (trades.board[i] !== 'RG') return;
        const start = time - (time % (minutes * 60));
        const value = trades.price[i]! * trades.shares[i]!;
        values.set(start, (values.get(start) ?? 0) + value);
      });
      const midnight = Date.parse(`${trades.date}T00:00:00+07:00`) / 1000;
      return bars(trades, minutes).map((bar) => ({
        time: (midnight + bar.time) as UTCTimestamp,
        date: trades.date,
        endDate: trades.date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.shares,
        value: values.get(bar.time) ?? 0,
        estimated: false,
      }));
    })
    .sort((a, b) => Number(a.time) - Number(b.time));
}
