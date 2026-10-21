import { z } from 'zod';

export const fiveHolding = z.object({
  ticker: z.string(),
  investorName: z.string(),
  issuerName: z.string(),
  asOf: z.string(),
  combinedShares: z.number(),
  percent: z.number(),
  localForeign: z.string(),
  nationality: z.string().optional(),
  domicile: z.string().optional(),
  accounts: z.array(
    z.object({ holderName: z.string(), accountName: z.string(), shares: z.number() }),
  ),
});
export const fiveChange = z.object({
  date: z.string(),
  previousDate: z.string(),
  ticker: z.string(),
  investorName: z.string(),
  previousCombined: z.number(),
  currentCombined: z.number(),
  previousPercent: z.number(),
  currentPercent: z.number(),
  accounts: z.array(
    z.object({
      holderName: z.string(),
      accountName: z.string(),
      previousShares: z.number(),
      currentShares: z.number(),
      change: z.number(),
    }),
  ),
  localForeign: z.string(),
});
export const oneHolding = z.object({
  asOf: z.string(),
  ticker: z.string(),
  issuerName: z.string(),
  investorName: z.string(),
  classification: z.string().optional(),
  localForeign: z.string().optional(),
  nationality: z.string().optional(),
  domicile: z.string().optional(),
  scripless: z.number().optional(),
  scrip: z.number().optional(),
  total: z.number(),
  percent: z.number(),
});
export type FiveHolding = z.infer<typeof fiveHolding>;
export type FiveChange = z.infer<typeof fiveChange>;

export function date(value: string): string {
  const result = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || new Date(result).toISOString().slice(0, 10) !== result)
    throw new Error(`Invalid date: ${value}`);
  return result;
}
export function number(value: string): number {
  const cleaned = value.replaceAll(',', '').trim();
  const result = cleaned === '-' ? 0 : Number(cleaned);
  if (!Number.isFinite(result)) throw new Error(`Invalid number: ${value}`);
  return result;
}
