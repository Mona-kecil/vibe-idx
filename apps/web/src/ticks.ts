import { z } from 'zod';

export const tickKinds = ['book', 'trades'] as const;
export type TickKind = (typeof tickKinds)[number];

const level = z.tuple([z.number(), z.number(), z.number()]);
export const tickBookSchema = z.object({
  date: z.iso.date(),
  ticker: z.string(),
  close: z.number().nullable(),
  bid: z.array(level),
  offer: z.array(level),
});
export type TickBook = z.infer<typeof tickBookSchema>;

const numbers = z.array(z.number());
const strings = z.array(z.string());
const flags = z.array(z.boolean());
export const tickTradesSchema = z
  .object({
    date: z.iso.date(),
    ticker: z.string(),
    time: numbers,
    price: numbers,
    shares: numbers,
    side: z.array(z.enum(['b', 's'])),
    auction: flags,
    board: strings,
    buyer: strings,
    buyer_foreign: flags,
    seller: strings,
    seller_foreign: flags,
    buy_order: numbers,
    sell_order: numbers,
  })
  .refine(
    ({ date: _date, ticker: _ticker, ...columns }) =>
      Object.values(columns).every((column) => column.length === columns.time.length),
    'Trade columns differ in length',
  );
export type TickTrades = z.infer<typeof tickTradesSchema>;

export const clock = (seconds: number) =>
  [seconds / 3600, (seconds / 60) % 60, seconds % 60]
    .map((part) => String(Math.floor(part)).padStart(2, '0'))
    .join(':');

export type Party = { broker: string; foreign: boolean; shares: number };
export type Block = {
  session: 'continuous' | 'auction';
  side: 'buy' | 'sell';
  order: number;
  broker: string;
  foreign: boolean;
  start: number;
  end: number;
  shares: number;
  value: number;
  low: number;
  high: number;
  fills: number;
  counterparties: Party[];
};

/**
 * Done detail. A continuous-session trade belongs to the aggressive order that `side` names. Auction matches have
 * no aggressor, so each order on either side becomes its own block.
 */
export function doneDetail(trades: TickTrades): Block[] {
  const blocks = new Map<string, Block & { parties: Map<string, Party> }>();
  const add = (i: number, side: 'buy' | 'sell', session: Block['session']) => {
    const buy = side === 'buy';
    const order = buy ? trades.buy_order[i]! : trades.sell_order[i]!;
    const key = `${session}:${side}:${order}`;
    const price = trades.price[i]!,
      shares = trades.shares[i]!,
      time = trades.time[i]!;
    const block = blocks.get(key) ?? {
      session,
      side,
      order,
      broker: buy ? trades.buyer[i]! : trades.seller[i]!,
      foreign: buy ? trades.buyer_foreign[i]! : trades.seller_foreign[i]!,
      start: time,
      end: time,
      shares: 0,
      value: 0,
      low: price,
      high: price,
      fills: 0,
      counterparties: [],
      parties: new Map<string, Party>(),
    };
    block.end = Math.max(block.end, time);
    block.shares += shares;
    block.value += shares * price;
    block.low = Math.min(block.low, price);
    block.high = Math.max(block.high, price);
    block.fills++;
    const broker = buy ? trades.seller[i]! : trades.buyer[i]!;
    const foreign = buy ? trades.seller_foreign[i]! : trades.buyer_foreign[i]!;
    const party = block.parties.get(`${broker}:${foreign}`) ?? { broker, foreign, shares: 0 };
    party.shares += shares;
    block.parties.set(`${broker}:${foreign}`, party);
    blocks.set(key, block);
  };
  trades.time.forEach((_, i) => {
    if (trades.board[i] !== 'RG') return;
    if (trades.auction[i]) {
      add(i, 'buy', 'auction');
      add(i, 'sell', 'auction');
    } else add(i, trades.side[i] === 'b' ? 'buy' : 'sell', 'continuous');
  });
  return [...blocks.values()].map(({ parties, ...block }) => ({
    ...block,
    counterparties: [...parties.values()].sort((a, b) => b.shares - a.shares),
  }));
}

export type BookLevel = {
  price: number;
  buy: number;
  sell: number;
  auction: number;
  foreign: number;
};
/** Regular-board shares traded at each price, split by which side was aggressive. */
export function tradeBook(trades: TickTrades): BookLevel[] {
  const levels = new Map<number, BookLevel>();
  trades.time.forEach((_, i) => {
    if (trades.board[i] !== 'RG') return;
    const price = trades.price[i]!,
      shares = trades.shares[i]!;
    const level = levels.get(price) ?? { price, buy: 0, sell: 0, auction: 0, foreign: 0 };
    if (trades.auction[i]) level.auction += shares;
    else if (trades.side[i] === 'b') level.buy += shares;
    else level.sell += shares;
    level.foreign +=
      ((trades.buyer_foreign[i] ? shares : 0) + (trades.seller_foreign[i] ? shares : 0)) / 2;
    levels.set(price, level);
  });
  return [...levels.values()].sort((a, b) => b.price - a.price);
}

export type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  shares: number;
  foreignBuy: number;
  foreignSell: number;
};
/** Regular-board bars of `minutes` length, keyed by the bar's start in seconds after midnight. */
export function bars(trades: TickTrades, minutes: number): Bar[] {
  const result = new Map<number, Bar>();
  trades.time.forEach((time, i) => {
    if (trades.board[i] !== 'RG') return;
    const start = time - (time % (minutes * 60));
    const price = trades.price[i]!,
      shares = trades.shares[i]!;
    const bar = result.get(start) ?? {
      time: start,
      open: price,
      high: price,
      low: price,
      close: price,
      shares: 0,
      foreignBuy: 0,
      foreignSell: 0,
    };
    bar.high = Math.max(bar.high, price);
    bar.low = Math.min(bar.low, price);
    bar.close = price;
    bar.shares += shares;
    if (trades.buyer_foreign[i]) bar.foreignBuy += shares;
    if (trades.seller_foreign[i]) bar.foreignSell += shares;
    result.set(start, bar);
  });
  return [...result.values()].sort((a, b) => a.time - b.time);
}
