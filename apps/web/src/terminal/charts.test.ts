import { describe, expect, it } from 'vite-plus/test';
import { tickerSchema } from '../data';
import { tickTradesSchema } from '../ticks';
import { chartDate, dailyBars, intradayBars, weeklyBars } from './charts';

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
      net_foreign: 30,
      estimated: true,
    });
    expect(weekly[1]).toMatchObject({ date: '2021-01-04', close: 105, volume: 300 });
    expect(prices[0]?.volume).toBe(100);
  });

  it('reuses regular-board aggregation, sums foreign IDR at trade prices, and omits empty intervals', () => {
    const trades = tickTradesSchema.parse({
      date: '2026-11-10',
      ticker: 'TEST',
      time: [32400, 32500, 48600, 48601],
      price: [100, 110, 90, 999],
      shares: [100, 200, 300, 1000],
      side: ['b', 's', 'b', 'b'],
      auction: [false, false, false, false],
      board: ['RG', 'RG', 'RG', 'NG'],
      buyer: ['AA', 'BB', 'CC', 'DD'],
      seller: ['DD', 'CC', 'BB', 'AA'],
      buyer_foreign: [true, false, true, true],
      seller_foreign: [false, true, true, false],
      buy_order: [1, 2, 3, 4],
      sell_order: [5, 6, 7, 8],
    });
    const result = intradayBars([trades, { ...trades, date: '2026-11-11' }], 15);
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({
      open: 100,
      high: 110,
      low: 100,
      close: 110,
      volume: 300,
      net_foreign: -12000,
    });
    expect(result[1]).toMatchObject({ volume: 300, net_foreign: 0 });
    expect(result[0]?.time).toBe(Date.parse('2026-11-10T09:00:00+07:00') / 1000);
    expect(chartDate(result[2]?.time)).toBe('2026-11-11');
    expect(intradayBars([trades], 60)).toHaveLength(2);
    expect(intradayBars([trades], 240)).toHaveLength(2);
  });
});
