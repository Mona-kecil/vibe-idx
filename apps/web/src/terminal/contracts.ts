import { z } from 'zod';
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const sourceUrl = z.url().refine((value) => /^https?:/.test(value));
export const headlineSchema = z.object({
  ts: timestamp,
  src: z.string(),
  title: z.string(),
  link: sourceUrl,
  region: z.enum(['ID', 'WORLD', 'TICKER']),
  sum: z.string().default(''),
  tags: z.array(z.string()),
});
export const calendarEventSchema = z
  .object({
    ts: timestamp,
    c: z.string(),
    imp: z.number(),
    ev: z.string(),
    f: z.string().nullable().optional(),
    p: z.string().nullable().optional(),
    url: sourceUrl,
    by: z.string(),
    sUrl: sourceUrl.optional(),
    sBy: z.string().optional(),
    note: z.string().optional(),
    est: z.string().optional(),
    source_id: z.string().optional(),
    dateOnly: z.boolean().optional(),
  })
  .transform((event) => ({
    ...event,
    dateOnly:
      event.dateOnly ??
      (/^Date only/i.test(event.est ?? '') ||
        (['bi', 'bps'].includes(event.source_id ?? '') &&
          new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Jakarta',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(event.ts)) === '00:00')),
  }));
