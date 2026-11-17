import { describe, expect, it } from 'vite-plus/test';
import { tickerSchema } from './data';
import {
  sessionOpen,
  isBlockTrade,
  bars,
  barFileSchema,
  clock,
  combineBars,
  doneDetail,
  packBars,
  sessionBars,
  tickTradesSchema,
  tradeBook,
  unpackBars,
} from './ticks';
import { seconds, tradeSession, type Fill } from './test-builders';

const session = (fills: Fill[]) => tradeSession(fills, { date: '2026-11-10', ticker: 'SINI' });

// XL's sell order 99 sweeps two bids; AK then buys twice on the offer.
const day = session([
  {
    time: '08:58:00',
    price: 7700,
    shares: 3000,
    side: 's',
    buyer: 'PG',
    seller: 'XL',
    auction: true,
  },
  {
    time: '09:05:29',
    price: 7675,
    shares: 40000,
    side: 's',
    buyer: 'XC',
    seller: 'XL',
    sellOrder: 99,
  },
  {
    time: '09:05:29',
    price: 7650,
    shares: 105000,
    side: 's',
    buyer: 'YP',
    seller: 'XL',
    sellOrder: 99,
    buyerForeign: true,
  },
  { time: '09:05:31', price: 7650, shares: 2000, buyer: 'AK', seller: 'XC', buyerForeign: true },
  { time: '09:07:02', price: 7675, shares: 500, buyer: 'AK', seller: 'YP' },
  {
    time: '16:20:00',
    price: 7000,
    shares: 500000,
    buyer: 'AO',
    seller: 'AO',
    board: 'NG',
    buyOrder: 200,
    sellOrder: 201,
  },
]);

describe('done detail', () => {
  it('groups continuous fills by the aggressive order and lists who took the other side', () => {
    const sweep = doneDetail(day).find(
      (block) => block.matching === 'continuous' && block.order === 99,
    );
    expect(sweep).toMatchObject({
      matching: 'continuous',
      side: 'sell',
      order: 99,
      broker: 'XL',
      start: seconds('09:05:29'),
      shares: 145000,
      low: 7650,
      high: 7675,
      fills: 2,
      counterparties: [
        { broker: 'YP', foreign: true, shares: 105000 },
        { broker: 'XC', foreign: false, shares: 40000 },
      ],
    });
  });

  it('splits auction orders and includes negotiated trades separately', () => {
    const blocks = doneDetail(day);
    expect(blocks.filter((b) => b.matching === 'auction').map((b) => [b.side, b.broker])).toEqual([
      ['buy', 'PG'],
      ['sell', 'XL'],
    ]);
    expect(blocks.find((b) => b.broker === 'AO')).toMatchObject({
      matching: 'off-board',
      side: 'none',
      board: 'NG',
      buyOrder: 200,
      sellOrder: 201,
      fills: 1,
    });
    expect(blocks.filter((b) => b.side === 'buy' && b.matching === 'continuous')).toHaveLength(2);
  });
});

it('splits regular-board shares at each price by aggressor and counts foreign participation', () => {
  expect(tradeBook(day)).toEqual([
    { price: 7700, buy: 0, sell: 0, auction: 3000, foreign: 0 },
    { price: 7675, buy: 500, sell: 40000, auction: 0, foreign: 0 },
    { price: 7650, buy: 2000, sell: 105000, auction: 0, foreign: 53500 },
  ]);
});

it('builds regular-board bars of any size from trade times', () => {
  expect(
    bars(day, 5).map((b) => [clock(b.time), b.open, b.high, b.low, b.close, b.shares]),
  ).toEqual([
    ['08:55:00', 7700, 7700, 7700, 7700, 3000],
    ['09:05:00', 7675, 7675, 7650, 7675, 147500],
  ]);
  const [hour] = bars(day, 60).filter((b) => b.time === seconds('09:00:00'));
  expect(hour).toMatchObject({ shares: 147500, foreignBuy: 107000, foreignSell: 0 });
});

describe('15-minute bar files', () => {
  const fills: Fill[] = [
    { time: '08:58:00', price: 100, shares: 300, auction: true, buyerForeign: true },
    { time: '09:00:01', price: 101, shares: 100, side: 's', sellerForeign: true },
    { time: '09:14:59', price: 99, shares: 200 },
    { time: '09:15:00', price: 105, shares: 400, buyerForeign: true, sellerForeign: true },
    { time: '10:59:59', price: 97, shares: 100 },
    { time: '11:00:00', price: 98, shares: 500 },
    { time: '12:44:00', price: 110, shares: 100, board: 'NG' },
    { time: '13:30:00', price: 96, shares: 700, sellerForeign: true },
    { time: '15:59:59', price: 102, shares: 100, side: 's' },
    { time: '16:00:00', price: 103, shares: 900, auction: true },
  ];
  const trades = session(fills);
  const midnight = Date.parse('2026-11-10T00:00:00+07:00') / 1000;

  it.each([60, 240])('combines into %i-minute bars exactly as fills would', (minutes) => {
    const direct = bars(trades, minutes).map((bar) => ({ ...bar, time: midnight + bar.time }));
    expect(combineBars(sessionBars(trades), minutes)).toEqual(direct);
    expect(direct.length).toBeGreaterThan(1);
  });

  it('keeps 15-minute bars as they are and counts only the regular board', () => {
    const rows = sessionBars(trades);
    expect(combineBars(rows, 15)).toEqual(rows);
    expect(rows.reduce((sum, bar) => sum + bar.shares, 0)).toBe(3300);
    expect(rows[0]).toMatchObject({ time: midnight + seconds('08:45:00'), value: 30000 });
  });

  it('packs rows into columns and back, and rejects ragged columns', () => {
    const rows = [...sessionBars(trades)].reverse();
    const file = packBars('SINI', rows);
    expect(barFileSchema.parse(file)).toEqual(file);
    expect(unpackBars(file)).toEqual(sessionBars(trades));
    expect(barFileSchema.safeParse({ ...file, close: file.close.slice(1) }).success).toBe(false);
  });
});

it('rejects trade columns of different lengths', () => {
  const broken = { ...day, price: day.price.slice(1) };
  expect(tickTradesSchema.safeParse(broken).success).toBe(false);
});

it('uses the daily open that GP charts, before falling back to the first RG continuous trade', () => {
  const ticker = tickerSchema.parse({
    ticker: 'SINI',
    name: 'SINI',
    holders: [],
    changes: [],
    prices: [
      { date: day.date, open: 7900, close: 8675, volume: 100, value: 867500, net_foreign: 0 },
    ],
  });
  expect(sessionOpen(ticker.prices, day)).toEqual({ price: 7900, source: 'GP daily open' });
  expect(sessionOpen([], day)).toEqual({ price: 7675, source: 'First RG continuous trade' });
  expect(sessionOpen([], { ...day, auction: day.auction.map(() => true) })).toBeNull();
});

it('keeps non-RG matches separate even with the same orders and never highlights RG by accident', () => {
  const orders = { buyOrder: 10, sellOrder: 20 };
  const trades = session([
    {
      ...orders,
      time: '09:00:00',
      price: 4960,
      shares: 24,
      buyer: 'CD',
      seller: 'CD',
      board: 'NG',
    },
    {
      ...orders,
      time: '09:00:01',
      price: 4960,
      shares: 71200,
      buyer: 'CD',
      seller: 'CD',
      board: 'NG',
    },
    {
      ...orders,
      time: '09:00:02',
      price: 5300,
      shares: 1900,
      buyer: 'CC',
      seller: 'NI',
      board: 'TN',
    },
    { ...orders, time: '09:00:03', price: 5300, shares: 1000, buyer: 'CD', seller: 'CD' },
  ]);
  const blocks = doneDetail(trades);
  expect(blocks).toHaveLength(4);
  for (const [index, block] of blocks.entries()) {
    const selection = { ...block, ticker: trades.ticker, date: trades.date };
    expect(trades.time.map((_, i) => isBlockTrade(trades, i, selection))).toEqual(
      trades.time.map((_, i) => i === index),
    );
  }
});
