import { describe, expect, it } from 'vite-plus/test';
import { bars, clock, doneDetail, tickTradesSchema, tradeBook, type TickTrades } from './ticks';

type Trade = [
  time: string,
  price: number,
  lots: number,
  side: 'b' | 's',
  buyer: string,
  seller: string,
  buyOrder: number,
  sellOrder: number,
  extra?: { auction?: boolean; board?: string; buyerForeign?: boolean; sellerForeign?: boolean },
];
const seconds = (time: string) => {
  const [h, m, s] = time.split(':').map(Number);
  return h! * 3600 + m! * 60 + s!;
};
function session(rows: Trade[]): TickTrades {
  return tickTradesSchema.parse({
    date: '2026-11-10',
    ticker: 'SINI',
    time: rows.map((r) => seconds(r[0])),
    price: rows.map((r) => r[1]),
    shares: rows.map((r) => r[2] * 100),
    side: rows.map((r) => r[3]),
    auction: rows.map((r) => r[8]?.auction ?? false),
    board: rows.map((r) => r[8]?.board ?? 'RG'),
    buyer: rows.map((r) => r[4]),
    buyer_foreign: rows.map((r) => r[8]?.buyerForeign ?? false),
    seller: rows.map((r) => r[5]),
    seller_foreign: rows.map((r) => r[8]?.sellerForeign ?? false),
    buy_order: rows.map((r) => r[6]),
    sell_order: rows.map((r) => r[7]),
  });
}

const day = session([
  ['08:58:00', 7700, 30, 's', 'PG', 'XL', 1, 2, { auction: true }],
  ['09:05:29', 7675, 400, 's', 'XC', 'XL', 10, 99],
  ['09:05:29', 7650, 1050, 's', 'YP', 'XL', 11, 99, { buyerForeign: true }],
  ['09:05:31', 7650, 20, 'b', 'AK', 'XC', 120, 12, { buyerForeign: true }],
  ['09:07:02', 7675, 5, 'b', 'AK', 'YP', 121, 13],
  ['16:20:00', 7000, 5000, 'b', 'AO', 'AO', 200, 201, { board: 'NG' }],
]);

describe('done detail', () => {
  it('groups continuous fills by the aggressive order and lists who took the other side', () => {
    const [sweep] = doneDetail(day).sort((a, b) => b.shares - a.shares);
    expect(sweep).toMatchObject({
      session: 'continuous',
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

  it('splits an auction match into one block per order on each side and skips negotiated trades', () => {
    const blocks = doneDetail(day);
    expect(blocks.filter((b) => b.session === 'auction').map((b) => [b.side, b.broker])).toEqual([
      ['buy', 'PG'],
      ['sell', 'XL'],
    ]);
    expect(blocks.some((b) => b.broker === 'AO')).toBe(false);
    expect(blocks.filter((b) => b.side === 'buy' && b.session === 'continuous')).toHaveLength(2);
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

it('rejects trade columns of different lengths', () => {
  const broken = { ...day, price: day.price.slice(1) };
  expect(tickTradesSchema.safeParse(broken).success).toBe(false);
});
