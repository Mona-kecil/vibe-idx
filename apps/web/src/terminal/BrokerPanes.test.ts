import { describe, expect, it } from 'vite-plus/test';
import type { TickTrades } from '../ticks';
import { intradayFlows, zeroCenteredAutoscale } from './BrokerPanes';

describe('foreign flow scales', () => {
  it.each([
    { minValue: -40e9, maxValue: 26e9 },
    { minValue: -3e9, maxValue: 60e9 },
    { minValue: -8e12, maxValue: -2e12 },
    { minValue: 2e12, maxValue: 8e12 },
    { minValue: 0, maxValue: 0 },
  ])('keeps zero halfway up each axis without clipping %o', (range) => {
    const result = zeroCenteredAutoscale(() => ({ priceRange: range }));
    expect(result?.priceRange).toBeTruthy();
    if (!result?.priceRange) return;
    const { minValue, maxValue } = result.priceRange;
    expect(minValue).toBeLessThanOrEqual(range.minValue);
    expect(maxValue).toBeGreaterThanOrEqual(range.maxValue);
    expect(maxValue).toBeGreaterThan(minValue);
    expect(-minValue / (maxValue - minValue)).toBe(0.5);
  });

  it('leaves an empty visible range empty', () => {
    expect(zeroCenteredAutoscale(() => null)).toBeNull();
    expect(zeroCenteredAutoscale(() => ({ priceRange: null }))).toBeNull();
  });
});

describe('intraday broker flow', () => {
  const trades: TickTrades = {
    date: '2026-11-10',
    ticker: 'SINI',
    time: [32400, 32410, 32470, 36000],
    price: [100, 100, 110, 120],
    shares: [1000, 500, 2000, 300],
    side: ['b', 's', 'b', 'b'],
    auction: [false, false, false, false],
    board: ['RG', 'RG', 'RG', 'NG'],
    buyer: ['AA', 'BB', 'AA', 'BB'],
    buyer_foreign: [false, true, false, true],
    seller: ['BB', 'AA', 'CC', 'AA'],
    seller_foreign: [true, false, true, false],
    buy_order: [1, 2, 3, 4],
    sell_order: [5, 6, 7, 8],
  };
  const at = (clock: string) => Date.parse(`2026-11-10T${clock}Z`) / 1000;

  it('sums each broker from the open, one point per minute that traded on the board', () => {
    const flow = intradayFlows(trades, { board: 'regular', type: 'ALL', unit: 'VALUE' });
    expect(flow.times).toEqual([at('09:00:00'), at('09:01:00')]);
    const values = (code: string) =>
      flow.series.find((series) => series.code === code)?.points.map((p) => p.value);
    expect(values('AA')).toEqual([50000, 270000]);
    expect(values('BB')).toEqual([-50000, -50000]);
    expect(values('CC')).toEqual([0, -220000]);
    expect(flow.closes.get(at('09:01:00'))).toBe(110);
  });

  it('counts only the side whose client matches the domicile, in lots when asked', () => {
    const flow = intradayFlows(trades, { board: 'all', type: 'FOREIGN', unit: 'LOT' });
    expect(flow.series.map((series) => series.code).sort()).toEqual(['BB', 'CC']);
    expect(flow.series.find((series) => series.code === 'BB')?.points.at(-1)?.value).toBe(-2);
    expect(flow.series.find((series) => series.code === 'CC')?.points.at(-1)?.value).toBe(-20);
  });
});
