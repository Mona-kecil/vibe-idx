import { z } from 'zod';

export const brokerTickerSchema = z.string().regex(/^[A-Z0-9-]{1,12}$/);

export const brokerRowSchema = z.object({
  broker: z.string(),
  investor_type: z.string(),
  shares: z.number(),
  value: z.number(),
  avg_price: z.number(),
  freq: z.number(),
});

export const brokerDaySchema = z.object({
  date: z.iso.date(),
  buy: z.array(brokerRowSchema),
  sell: z.array(brokerRowSchema),
});

export const brokerHistorySchema = z.object({
  ticker: brokerTickerSchema,
  days: z.array(brokerDaySchema),
});

export type BrokerRow = z.infer<typeof brokerRowSchema>;
export type BrokerDay = z.infer<typeof brokerDaySchema>;
export type BrokerHistory = z.infer<typeof brokerHistorySchema>;
