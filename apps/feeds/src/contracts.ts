import { z } from 'zod';

export const tickerSchema = z
  .array(z.object({ ticker: z.string().regex(/^[A-Z]{4,5}$/), name: z.string().min(1) }))
  .min(1);
export type Ticker = z.infer<typeof tickerSchema>[number];
export const headlineSchema = z.object({
  ts: z.iso.datetime(),
  src: z.string(),
  title: z.string().min(1),
  link: z.url(),
  region: z.enum(['ID', 'WORLD', 'TICKER']),
  sum: z.string(),
  tags: z.array(z.string()),
  source_id: z.string(),
});
export type Headline = z.infer<typeof headlineSchema>;
export const calendarEventSchema = z.object({
  ts: z.iso.datetime(),
  c: z.string(),
  imp: z.number(),
  ev: z.string().min(1),
  f: z.string().nullable().optional(),
  p: z.string().nullable().optional(),
  url: z.url(),
  by: z.string(),
  sUrl: z.url().optional(),
  sBy: z.string().optional(),
  note: z.string().optional(),
  est: z.string().optional(),
  source_id: z.string(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
const sourceSchema = z.object({
  as_of: z.iso.datetime().nullable(),
  attempted_at: z.iso.datetime(),
  status: z.enum(['ready', 'stale', 'unavailable']),
  count: z.number().int().nonnegative(),
});
export type SourceStatus = z.infer<typeof sourceSchema>;
const metadata = { as_of: z.iso.datetime(), sources: z.record(z.string(), sourceSchema) };
export const newsSchema = z.object({ ...metadata, news: z.array(headlineSchema) });
export const calendarSchema = z.object({ ...metadata, cal: z.array(calendarEventSchema) });
