import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { Parser } from 'htmlparser2';
import { z } from 'zod';
import { calendarEventSchema, headlineSchema, type CalendarEvent } from './contracts';

export function cleanHTML(html: string): string {
  let text = '',
    hidden = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        if (['script', 'style'].includes(name)) hidden++;
        else if (!hidden) text += ' ';
      },
      onclosetag(name) {
        if (['script', 'style'].includes(name)) hidden = Math.max(0, hidden - 1);
        else if (!hidden) text += ' ';
      },
      ontext(value) {
        if (!hidden) text += value;
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  return text
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const itemSchema = z.object({
  title: z.string(),
  link: z.string().optional(),
  guid: z.string().optional(),
  pubDate: z.string(),
  description: z.string().optional(),
});
const rssSchema = z.object({
  rss: z.object({ channel: z.object({ item: z.array(z.unknown()).min(1) }) }),
});
export function parseRSS(
  xml: string,
  feed: { id: string; src: string; region: 'ID' | 'WORLD' },
  tag: (text: string) => string[],
) {
  if (XMLValidator.validate(xml) !== true) throw new Error('Invalid RSS XML');
  const parsed: unknown = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    isArray: (name) => name === 'item',
  }).parse(xml);
  const items = rssSchema.parse(parsed).rss.channel.item;
  const rows = items.flatMap((raw) => {
    const item = itemSchema.safeParse(raw);
    if (!item.success || !Number.isFinite(Date.parse(item.data.pubDate))) return [];
    const n = item.data,
      title = cleanHTML(n.title),
      sum = cleanHTML(n.description ?? '');
    if (/^Video:/i.test(title)) return [];
    const result = headlineSchema.safeParse({
      ts: new Date(n.pubDate).toISOString(),
      src: feed.src,
      title,
      link: n.link ?? n.guid,
      region: feed.region,
      sum,
      tags: feed.region === 'ID' ? tag(`${title} ${sum}`) : [],
      source_id: feed.id,
    });
    return result.success ? [result.data] : [];
  });
  if (!rows.length) throw new Error('RSS contained no usable headlines');
  return rows;
}
const ffSchema = z
  .array(
    z.object({
      date: z.string(),
      impact: z.string(),
      country: z.string(),
      title: z.string(),
      forecast: z.string().optional(),
      previous: z.string().optional(),
    }),
  )
  .min(1);
export const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
export function parseForexFactory(raw: unknown): CalendarEvent[] {
  const countries: Record<string, string> = {
    USD: 'US',
    CNY: 'CN',
    EUR: 'EU',
    JPY: 'JP',
    GBP: 'GB',
    AUD: 'AU',
    CAD: 'CA',
    NZD: 'NZ',
    CHF: 'CH',
  };
  return ffSchema
    .parse(raw)
    .filter(
      (e) =>
        e.impact === 'High' ||
        (e.impact === 'Medium' && ['USD', 'CNY', 'EUR', 'JPY'].includes(e.country)),
    )
    .map((e) =>
      calendarEventSchema.parse({
        ts: new Date(e.date).toISOString(),
        c: countries[e.country] ?? e.country,
        imp: e.impact === 'High' ? 3 : 2,
        ev: e.title,
        f: e.forecast || null,
        p: e.previous || null,
        by: 'Forex Factory',
        url: 'https://www.forexfactory.com/calendar',
        source_id: 'forexfactory',
      }),
    );
}
export const BI_URL = 'https://www.bi.go.id/id/publikasi/Kalender/Default.aspx';
const dateSchema = z.iso.date();
function indonesianEvent(
  date: string,
  ev: string,
  source: 'bps' | 'bi',
  url: string,
  note?: string,
): CalendarEvent {
  return calendarEventSchema.parse({
    ts: new Date(`${dateSchema.parse(date)}T00:00:00+07:00`).toISOString(),
    c: 'ID',
    imp: source === 'bi' ? 3 : 2,
    ev,
    url,
    by: source === 'bi' ? 'Bank Indonesia' : 'BPS',
    source_id: source,
    est: 'Date only; release time not published by source (00:00 WIB is a placeholder)',
    ...(note ? { note } : {}),
  });
}
const bpsReleaseSchema = z.object({
  status: z.literal('OK'),
  'data-availability': z.literal('available'),
  data: z.tuple([
    z.object({ page: z.number(), pages: z.number().int().nonnegative() }),
    z.array(
      z.object({
        brs_id: z.union([z.string(), z.number()]),
        title: z.string(),
        rl_date: dateSchema,
      }),
    ),
  ]),
});
export function parseBPSReleases(raw: unknown) {
  const parsed = z
    .union([
      bpsReleaseSchema,
      z.object({ status: z.literal('OK'), 'data-availability': z.literal('not-available') }),
    ])
    .parse(raw);
  if (!('data' in parsed)) return { pages: 0, events: [] };
  const data = parsed.data;
  return {
    pages: data[0].pages,
    events: data[1].map((e) =>
      indonesianEvent(
        e.rl_date,
        cleanHTML(e.title),
        'bps',
        `https://www.bps.go.id/id/pressrelease/${e.rl_date.replaceAll('-', '/')}/${e.brs_id}`,
      ),
    ),
  };
}
export function parseBI(html: string, year: number): CalendarEvent[] {
  const months = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((m) =>
    cleanHTML(m[0]),
  );
  const schedule = tables.find(
    (t) =>
      months.every((month) => new RegExp(`\\b${month}\\b`, 'i').test(t)) &&
      t.includes(String(year)) &&
      /Waktu/.test(t),
  );
  if (!schedule) throw new Error('BI RDG annual table missing');
  return months.map((month, i) => {
    const match = new RegExp(`(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})\\s+${month}\\s+${year}`, 'i').exec(
      schedule,
    );
    if (!match) throw new Error('BI RDG month missing');
    const date = `${year}-${String(i + 1).padStart(2, '0')}-${match[2]?.padStart(2, '0')}`;
    return indonesianEvent(
      date,
      'BI rate decision',
      'bi',
      BI_URL,
      `RDG ${match[1]}–${match[2]} ${month} ${year}; decision on second day`,
    );
  });
}
