import { z } from 'zod';

export const brokerTickerSchema = z.string().regex(/^[A-Z0-9-]{1,12}$/);

export const brokerBoards = ['regular', 'negotiation', 'cash'] as const;
export type BrokerBoard = (typeof brokerBoards)[number];

const brokerAmounts = z.object({
  broker: z.string(),
  shares: z.number(),
  value: z.number(),
  avg_price: z.number(),
  freq: z.number(),
});
const brokerTypeSchema = z.enum(['local', 'foreign', 'government', 'unknown']);
const brokerRowSchema = brokerAmounts.extend({
  investor: z.enum(['domestic', 'foreign', 'unknown']),
  broker_type: brokerTypeSchema,
});
/** Who owns the broker firm, which colours its code. Not where its clients are based. */
export const brokerOwnership: Record<z.infer<typeof brokerTypeSchema>, string> = {
  local: 'Domestic-owned',
  foreign: 'Foreign-owned',
  government: 'State-owned',
  unknown: 'Ownership unknown',
};
export type InvestorFilter = 'ALL' | 'FOREIGN' | 'DOMESTIC';
export function matchesInvestor(row: BrokerRow, filter: InvestorFilter) {
  return filter === 'ALL' || row.investor === filter.toLowerCase();
}

export const brokerDaySchema = z.object({
  date: z.iso.date(),
  board: z.enum(brokerBoards),
  buy: z.array(brokerRowSchema),
  sell: z.array(brokerRowSchema),
});

export const brokerHistorySchema = z.object({
  ticker: brokerTickerSchema,
  days: z.array(brokerDaySchema),
});

export type BrokerRow = z.infer<typeof brokerRowSchema>;
export type BrokerDay = z.infer<typeof brokerDaySchema>;

const accumulationWindowSchema = z
  .object({
    pct: z.number(),
    broker: z.string(),
    size: z.number().nullable().default(null),
    broker_avg: z.number().nullable().default(null),
    stock_avg: z.number().nullable().default(null),
    buy_trades: z.number().nullable().default(null),
    trades: z.number().nullable().default(null),
  })
  .nullable();
export const accumulationSchema = z.object({
  date: z.iso.date().nullable(),
  stocks: z.array(
    z.object({
      ticker: brokerTickerSchema,
      windows: z.object({
        '1d': accumulationWindowSchema,
        '3d': accumulationWindowSchema,
        '5d': accumulationWindowSchema,
      }),
    }),
  ),
});
export type Accumulation = z.infer<typeof accumulationSchema>;

export const brokerCodeSchema = z.string().regex(/^[A-Z0-9]{2,4}$/);
const columns = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).refine(
    (value) =>
      new Set(
        Object.values(value)
          .filter((column) => Array.isArray(column))
          .map((column) => column.length),
      ).size <= 1,
    'Columns differ in length',
  );
const amounts = {
  ticker: z.array(z.string()),
  buy_value: z.array(z.number()),
  buy_shares: z.array(z.number()),
  sell_value: z.array(z.number()),
  sell_shares: z.array(z.number()),
};
/** What one broker bought and sold in each ticker, per session and board. */
export const brokerLedgerSchema = z.object({
  broker: brokerCodeSchema,
  days: z.array(columns({ date: z.iso.date(), board: z.enum(brokerBoards), ...amounts })),
});
export type BrokerLedger = z.infer<typeof brokerLedgerSchema>;
/** One broker's buying and selling in one session, per minute, ticker and board. */
export const brokerSessionSchema = columns({
  date: z.iso.date(),
  broker: brokerCodeSchema,
  minute: z.array(z.number()),
  board: z.array(z.string()),
  ...amounts,
});
export type BrokerSession = z.infer<typeof brokerSessionSchema>;
