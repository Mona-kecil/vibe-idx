import type { BrokerRow } from './brokers.js';
import { tickTradesSchema, type TickTrades } from './ticks.js';

/** Seconds after midnight, the unit of a trade's time, from `HH:MM:SS`. */
export const seconds = (time: string) => {
  const [h, m, s] = time.split(':').map(Number);
  return h! * 3600 + m! * 60 + s!;
};

/**
 * One fill as a test writes it. Left out, a fill is a 100-share continuous regular-board buy at 100 by AA from BB
 * at 09:00:00, with its own buy and sell orders, so fills never share a block by accident.
 */
export type Fill = {
  /** `HH:MM:SS`, or seconds after midnight. */
  time?: string | number;
  price?: number;
  shares?: number;
  side?: 'b' | 's';
  auction?: boolean;
  board?: string;
  buyer?: string;
  seller?: string;
  buyerForeign?: boolean;
  sellerForeign?: boolean;
  buyOrder?: number;
  sellOrder?: number;
};

/** A session of running trade, row by row, in the column layout the API serves. */
export function tradeSession(
  fills: Fill[],
  { date = '2026-11-10', ticker = 'BBCA' }: { date?: string; ticker?: string } = {},
): TickTrades {
  const rows = fills.map((fill, i) => ({
    time: typeof fill.time === 'string' ? seconds(fill.time) : (fill.time ?? seconds('09:00:00')),
    price: fill.price ?? 100,
    shares: fill.shares ?? 100,
    side: fill.side ?? 'b',
    auction: fill.auction ?? false,
    board: fill.board ?? 'RG',
    buyer: fill.buyer ?? 'AA',
    seller: fill.seller ?? 'BB',
    buyer_foreign: fill.buyerForeign ?? false,
    seller_foreign: fill.sellerForeign ?? false,
    buy_order: fill.buyOrder ?? 2 * i + 1,
    sell_order: fill.sellOrder ?? 2 * i + 2,
  }));
  const column = <K extends keyof (typeof rows)[number]>(key: K) => rows.map((row) => row[key]);
  return tickTradesSchema.parse({
    date,
    ticker,
    time: column('time'),
    price: column('price'),
    shares: column('shares'),
    side: column('side'),
    auction: column('auction'),
    board: column('board'),
    buyer: column('buyer'),
    buyer_foreign: column('buyer_foreign'),
    seller: column('seller'),
    seller_foreign: column('seller_foreign'),
    buy_order: column('buy_order'),
    sell_order: column('sell_order'),
  });
}

/** One broker's side of a day in broker data: a domestic client at a local broker unless `fields` says otherwise. */
export function brokerRow(
  broker: string,
  shares: number,
  value: number,
  fields: Partial<BrokerRow> = {},
): BrokerRow {
  return {
    broker,
    investor: 'domestic',
    broker_type: 'local',
    shares,
    value,
    avg_price: value / shares,
    freq: 1,
    ...fields,
  };
}
