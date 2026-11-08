import { expect, it } from 'vite-plus/test';
import { tickerSchema } from './data';

it('accepts daily OHLC and normalizes legacy missing prices to null', () => {
  const day = { date: '2026-10-21', close: 100, volume: 10, value: 1000, net_foreign: 0 };
  const ticker = { ticker: 'TEST', name: 'Test', holders: [], changes: [] };
  expect(tickerSchema.parse({ ...ticker, prices: [day] }).prices[0]).toEqual({
    ...day,
    open: null,
    high: null,
    low: null,
  });
  const candle = { ...day, open: 95, high: 105, low: 90 };
  expect(tickerSchema.parse({ ...ticker, prices: [candle] }).prices[0]).toEqual(candle);
});
