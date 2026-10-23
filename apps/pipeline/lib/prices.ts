import { z } from 'zod';
import { date } from './rows';

const stock = z.object({
  Date: z.string(),
  StockCode: z.string(),
  Previous: z.number(),
  OpenPrice: z.number(),
  High: z.number(),
  Low: z.number(),
  Close: z.number(),
  Change: z.number(),
  Volume: z.number(),
  Value: z.number(),
  Frequency: z.number(),
  ForeignBuy: z.number(),
  ForeignSell: z.number(),
  ListedShares: z.number(),
  TradebleShares: z.number(),
  Remarks: z.string(),
});
export function parsePrices(input: unknown) {
  const response = z.object({ recordsTotal: z.number(), data: z.array(stock) }).parse(input);
  if (response.recordsTotal !== response.data.length) throw new Error('Incomplete stock summary');
  return response.data.map((r) => ({
    date: date(r.Date),
    ticker: r.StockCode.trim(),
    previous: r.Previous,
    open: r.OpenPrice,
    high: r.High,
    low: r.Low,
    close: r.Close,
    change: r.Change,
    volume: r.Volume,
    value: r.Value,
    frequency: r.Frequency,
    foreignBuy: r.ForeignBuy,
    foreignSell: r.ForeignSell,
    listedShares: r.ListedShares,
    tradableShares: r.TradebleShares,
    remarks: r.Remarks,
  }));
}
