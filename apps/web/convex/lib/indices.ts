import { z } from 'zod';
import { date } from './rows';
const summary = z.object({
  Date: z.string(),
  IndexCode: z.string(),
  Close: z.number(),
  Previous: z.number().optional(),
  OpenPrice: z.number().optional(),
  Highest: z.number().optional(),
  Lowest: z.number().optional(),
  Change: z.number().optional(),
  Volume: z.number().optional(),
  Value: z.number().optional(),
  Frequency: z.number().optional(),
});
export function parseIndices(input: unknown) {
  const response = z.object({ recordsTotal: z.number(), data: z.array(summary) }).parse(input);
  if (response.recordsTotal !== response.data.length) throw new Error('Incomplete index summary');
  return response.data.map((r) => ({
    date: date(r.Date),
    code: r.IndexCode.trim(),
    close: r.Close,
    previous: r.Previous,
    open: r.OpenPrice,
    high: r.Highest,
    low: r.Lowest,
    change: r.Change,
    volume: r.Volume,
    value: r.Value,
    frequency: r.Frequency,
  }));
}
