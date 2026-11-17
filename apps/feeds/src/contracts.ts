import { z } from 'zod';

export const tickerSchema = z
  .array(
    z.object({
      ticker: z.string().regex(/^[A-Z]{4,5}$/),
      name: z.string().min(1),
      value: z.number().optional(),
    }),
  )
  .min(1);
export type Ticker = z.infer<typeof tickerSchema>[number];
export const newsArticleSchema = z.object({
  ts: z.iso.datetime(),
  src: z.string(),
  title: z.string().min(1),
  link: z.url(),
  region: z.enum(['ID', 'WORLD', 'TICKER']),
  sum: z.string(),
  tags: z.array(z.string()),
  source_id: z.string(),
});
/**
 * One Indonesian market article in the news archive, kept for good. `news/archive/YYYY-MM.json` holds a Jakarta
 * month of them, newest first, deduplicated by canonical link.
 */
const archiveArticleSchema = newsArticleSchema.pick({
  ts: true,
  src: true,
  title: true,
  link: true,
  tags: true,
  source_id: true,
});
export type ArchiveArticle = z.infer<typeof archiveArticleSchema>;
export const archiveSchema = z.object({
  month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
  as_of: z.iso.datetime(),
  articles: z.array(archiveArticleSchema),
});
/**
 * A ticker's archived news in the shape `/api/news` answers with, so the Worker only filters and cuts.
 * `news/ticker/CODE.json` holds every archived article tagged with the code, newest first.
 */
const tickerNewsRowSchema = z.object({
  title: z.string().min(1),
  url: z.url(),
  published_at: z.iso.datetime(),
  source: z.string(),
});
export type TickerNewsRow = z.infer<typeof tickerNewsRowSchema>;
export const tickerNewsSchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9-]{1,12}$/),
  as_of: z.iso.datetime(),
  news: z.array(tickerNewsRowSchema),
});
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
export const newsSchema = z.object({ ...metadata, news: z.array(newsArticleSchema) });
export const calendarSchema = z.object({ ...metadata, cal: z.array(calendarEventSchema) });
