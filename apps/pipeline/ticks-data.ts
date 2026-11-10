import { z } from 'zod';

export const sqlLiteral = (s: string) => `'${s.replaceAll("'", "''")}'`;
export const sessionDate = z.iso.date();
export const tickerCode = z.string().regex(/^[A-Z0-9-]+$/);
const integer = z
  .union([z.number(), z.string().regex(/^(?:\d+|\d{1,3}(?:,\d{3})+)$/)])
  .transform((v) => (typeof v === 'string' ? Number(v.replaceAll(',', '')) : v))
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
// Negotiated trades can be fractional lots ("664,646.65"), so convert to exact shares (100 per lot).
const shares = z
  .string()
  .regex(/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/)
  .transform((v) => {
    const [whole, fraction = ''] = v.replaceAll(',', '').split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  })
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const broker = z
  .string()
  .regex(/^[A-Z0-9]+ \[[DF]\]$/)
  .transform((v) => ({
    code: v.slice(0, v.indexOf(' ')),
    domicile: v.slice(-2, -1),
  }));
const tradeSchema = z.object({
  id: integer,
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/),
  action: z.enum(['buy', 'sell']),
  code: tickerCode,
  price: integer,
  lot: shares,
  buyer: broker,
  seller: broker,
  trade_number: integer.pipe(z.number().positive()),
  buyer_type: z.string().min(1),
  seller_type: z.string().min(1),
  market_board: z.string().min(1),
  buy_order_number: integer,
  sell_order_number: integer,
  group_order_number: integer,
  value: z.object({ raw: integer }),
});
const pageSchema = z.object({ data: z.object({ running_trade: z.array(tradeSchema).max(100) }) });

export function parseTradePage(raw: unknown, date: string) {
  sessionDate.parse(date);
  return pageSchema.parse(raw).data.running_trade.map((r) => ({
    date,
    ticker: r.code,
    trade_number: r.trade_number,
    id: r.id,
    time: r.time,
    // Regular-market auction matches have no meaningful aggressor. Keep the reported action separately.
    session:
      r.market_board === 'RG' &&
      (r.time < '09:00:00' || (r.time >= '15:50:00' && r.time < '16:02:00'))
        ? 'auction'
        : 'continuous',
    action: r.action,
    price: r.price,
    shares: r.lot,
    buyer: r.buyer.code,
    buyer_domicile: r.buyer.domicile,
    buyer_type: r.buyer_type,
    seller: r.seller.code,
    seller_domicile: r.seller.domicile,
    seller_type: r.seller_type,
    board: r.market_board,
    buy_order_number: r.buy_order_number,
    sell_order_number: r.sell_order_number,
    group_order_number: r.group_order_number,
    value: r.value.raw,
  }));
}
export type Trade = ReturnType<typeof parseTradePage>[number];

const level = z.object({ price: integer, que_num: integer, volume: integer });
const bookSchema = z.object({
  data: z.object({
    symbol: tickerCode,
    date: sessionDate.optional(),
    bid: z.array(level),
    offer: z.array(level),
    previous: integer,
    open: integer,
    high: integer,
    low: integer,
    close: integer,
    lastprice: integer,
    volume: integer,
    value: integer,
    frequency: integer,
    status: z.string(),
  }),
});
export function parseBook(raw: unknown, ticker: string, date: string, capturedAt: string) {
  sessionDate.parse(date);
  const r = bookSchema.parse(raw).data;
  if (r.symbol !== ticker || (r.date && r.date !== date))
    throw new Error('Closing book target mismatch');
  const header = {
    date: r.date ?? date,
    ticker,
    record_type: 'snapshot',
    side: null,
    level: null,
    price: null,
    orders: null,
    shares: null,
    captured_at: capturedAt,
    date_source: r.date ? 'payload' : 'idx_price_session',
    previous: r.previous,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    lastprice: r.lastprice,
    volume: r.volume,
    value: r.value,
    frequency: r.frequency,
    status: r.status,
  };
  const rows: BookRow[] = [header];
  for (const [side, levels] of [
    ['bid', r.bid],
    ['offer', r.offer],
  ] satisfies [string, z.infer<typeof level>[]][])
    levels.forEach((l, i) =>
      rows.push({
        ...header,
        record_type: 'level',
        side,
        level: i + 1,
        price: l.price,
        orders: l.que_num,
        shares: l.volume,
      }),
    );
  return rows;
}
export type BookRow = {
  date: string;
  ticker: string;
  record_type: string;
  side: string | null;
  level: number | null;
  price: number | null;
  orders: number | null;
  shares: number | null;
  captured_at: string;
  date_source: string;
  previous: number;
  open: number;
  high: number;
  low: number;
  close: number;
  lastprice: number;
  volume: number;
  value: number;
  frequency: number;
  status: string;
};

export const tradeColumns = `date DATE, ticker VARCHAR, trade_number BIGINT PRIMARY KEY, id BIGINT, time VARCHAR,
  session VARCHAR, action VARCHAR, price BIGINT, shares BIGINT, buyer VARCHAR, buyer_domicile VARCHAR,
  buyer_type VARCHAR, seller VARCHAR, seller_domicile VARCHAR, seller_type VARCHAR, board VARCHAR,
  buy_order_number BIGINT, sell_order_number BIGINT, group_order_number BIGINT, value BIGINT`;
export const bookColumns = `date DATE, ticker VARCHAR, record_type VARCHAR, side VARCHAR, level INTEGER,
  price BIGINT, orders BIGINT, shares BIGINT, captured_at VARCHAR, date_source VARCHAR,
  previous BIGINT, open BIGINT, high BIGINT, low BIGINT, close BIGINT, lastprice BIGINT,
  volume BIGINT, value BIGINT, frequency BIGINT, status VARCHAR`;

// Run against a running_trade table/view. Auctions intentionally participate in both order histories.
export const doneDetailSql = `
SELECT date, ticker, board, session, 'aggressor' AS role, action AS side,
  CASE action WHEN 'buy' THEN buy_order_number ELSE sell_order_number END AS order_number,
  trade_number, price, shares, buyer, buyer_domicile, seller, seller_domicile
FROM running_trade WHERE session = 'continuous'
UNION ALL
SELECT date, ticker, board, session, 'auction' AS role, 'buy' AS side, buy_order_number AS order_number,
  trade_number, price, shares, buyer, buyer_domicile, seller, seller_domicile
FROM running_trade WHERE session = 'auction'
UNION ALL
SELECT date, ticker, board, session, 'auction' AS role, 'sell' AS side, sell_order_number AS order_number,
  trade_number, price, shares, buyer, buyer_domicile, seller, seller_domicile
FROM running_trade WHERE session = 'auction'`;

// One private site file per ticker and session. Trades are columnar so a busy stock stays a few hundred KB gzipped.
export const siteSql = {
  running_trade: `SELECT ticker, to_json({
    date: any_value(date)::VARCHAR, ticker: ticker,
    time: list(extract('hour' FROM time::TIME) * 3600 + extract('minute' FROM time::TIME) * 60
      + extract('second' FROM time::TIME) ORDER BY trade_number),
    price: list(price ORDER BY trade_number), shares: list(shares ORDER BY trade_number),
    side: list(left(action, 1) ORDER BY trade_number), auction: list(session = 'auction' ORDER BY trade_number),
    board: list(board ORDER BY trade_number),
    buyer: list(buyer ORDER BY trade_number), buyer_foreign: list(buyer_domicile = 'F' ORDER BY trade_number),
    seller: list(seller ORDER BY trade_number), seller_foreign: list(seller_domicile = 'F' ORDER BY trade_number),
    buy_order: list(buy_order_number ORDER BY trade_number), sell_order: list(sell_order_number ORDER BY trade_number)
  })::VARCHAR AS json FROM running_trade GROUP BY ticker`,
  closing_book: `SELECT ticker, to_json({
    date: any_value(date)::VARCHAR, ticker: ticker, close: max(close),
    bid: coalesce(list([price, orders, shares] ORDER BY level) FILTER (WHERE side = 'bid'), []),
    offer: coalesce(list([price, orders, shares] ORDER BY level) FILTER (WHERE side = 'offer'), [])
  })::VARCHAR AS json FROM closing_book GROUP BY ticker`,
};
