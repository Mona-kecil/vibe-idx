import { describe, expect, it } from 'vite-plus/test';
import { tickerSchema } from '../data';
import { tradeSession } from '../test-builders';
import { packBars, sessionBars } from '../ticks';
import { barSeries, chartDate, dailyBars, latestSessionBars, weeklyBars } from './charts';

const prices = tickerSchema.parse({
  ticker: 'TEST',
  name: 'Test',
  holders: [],
  changes: [],
  prices: [
    {
      date: '2020-12-31',
      open: 90,
      high: 110,
      low: 80,
      close: 100,
      volume: 100,
      value: 10000,
      net_foreign: 50,
    },
    {
      date: '2021-01-01',
      open: null,
      high: 120,
      low: null,
      close: 115,
      volume: 200,
      value: 23000,
      net_foreign: -20,
    },
    { date: '2021-01-04', close: 105, volume: 300, value: 31500, net_foreign: -10 },
  ],
}).prices;

describe('price chart bars', () => {
  it('keeps candles on partially missing OHLC without inventing a daily range', () => {
    expect(
      dailyBars(prices).map(({ open, high, low, close, estimated }) => ({
        open,
        high,
        low,
        close,
        estimated,
      })),
    ).toEqual([
      { open: 90, high: 110, low: 80, close: 100, estimated: false },
      { open: 115, high: 120, low: 115, close: 115, estimated: true },
      { open: 105, high: 105, low: 105, close: 105, estimated: true },
    ]);
  });

  it('groups ISO weeks across year boundaries and keeps their full date bounds', () => {
    const weekly = weeklyBars(prices);
    expect(weekly).toHaveLength(2);
    expect(weekly[0]).toMatchObject({
      date: '2020-12-31',
      endDate: '2021-01-01',
      open: 90,
      high: 120,
      low: 80,
      close: 115,
      volume: 300,
      value: 33000,
      estimated: true,
    });
    expect(weekly[1]).toMatchObject({ date: '2021-01-04', close: 105, volume: 300 });
    expect(prices[0]?.volume).toBe(100);
  });

  it('combines the bar file for any timeframe, across sessions, and omits empty intervals', () => {
    const trades = tradeSession([
      { time: '09:00:00', price: 100, shares: 100, buyerForeign: true },
      { time: '09:01:40', price: 110, shares: 200, side: 's', sellerForeign: true },
      { time: '13:30:00', price: 90, shares: 300, buyerForeign: true, sellerForeign: true },
      { time: '13:30:01', price: 999, shares: 1000, board: 'NG', buyerForeign: true },
    ]);
    const file = packBars('BBCA', [
      ...sessionBars(trades),
      ...sessionBars({ ...trades, date: '2026-11-11' }),
    ]);
    const result = barSeries(file, 15);
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({
      open: 100,
      high: 110,
      low: 100,
      close: 110,
      volume: 300,
      value: 32000,
    });
    expect(result[1]).toMatchObject({ volume: 300 });
    expect(result[0]?.time).toBe(Date.parse('2026-11-10T09:00:00+07:00') / 1000);
    expect(chartDate(result[2]?.time)).toBe('2026-11-11');
    expect(result.map((bar) => [bar.date, bar.endDate])).toEqual(
      ['2026-11-10', '2026-11-10', '2026-11-11', '2026-11-11'].map((date) => [date, date]),
    );
    expect(barSeries(file, 60)).toHaveLength(4);
    expect(barSeries(file, 240)).toHaveLength(4);
    expect(barSeries(packBars('BBCA', sessionBars(trades)), 240)).toHaveLength(2);
    expect(barSeries(file, 240)[0]).toMatchObject({ open: 100, close: 110, volume: 300 });
    expect(barSeries(file, 240)[1]).toMatchObject({ open: 90, close: 90, volume: 300 });
  });

  it('opens on the latest sessions and shows all of them when there are fewer', () => {
    const day = (date: string) =>
      sessionBars(tradeSession([{ time: '09:05:00' }, { time: '13:30:00' }], { date }));
    const file = packBars('BBCA', ['2026-11-09', '2026-11-10', '2026-11-11'].flatMap(day));
    const series = barSeries(file, 15);
    expect(series).toHaveLength(6);
    expect(latestSessionBars(series, 2)).toBe(4);
    expect(latestSessionBars(series, 20)).toBe(6);
    expect(latestSessionBars([], 5)).toBe(0);
  });
});
