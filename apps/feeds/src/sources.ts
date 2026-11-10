import { z } from 'zod';
import type { Bucket } from './collector';
import { tickerSchema, type Ticker } from './contracts';
import {
  BI_URL,
  FF_URL,
  parseBI,
  parseBPSCalendar,
  parseBPSReleases,
  parseForexFactory,
  parseRSS,
} from './parsers';
import { tickerTagger } from './tagging';

export const FEEDS = [
  {
    id: 'cnbc-id',
    url: 'https://www.cnbcindonesia.com/market/rss',
    src: 'CNBC Indonesia',
    region: 'ID',
  },
  {
    id: 'antara',
    url: 'https://www.antaranews.com/rss/ekonomi-bursa.xml',
    src: 'Antara',
    region: 'ID',
  },
  {
    id: 'bloomberg',
    url: 'https://feeds.bloomberg.com/markets/news.rss',
    src: 'Bloomberg',
    region: 'WORLD',
  },
  {
    id: 'cnbc-world',
    url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html',
    src: 'CNBC',
    region: 'WORLD',
  },
  {
    id: 'cnbc-top',
    url: 'https://www.cnbc.com/id/15839069/device/rss/rss.html',
    src: 'CNBC',
    region: 'WORLD',
  },
  { id: 'wsj', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', src: 'WSJ', region: 'WORLD' },
] satisfies { id: string; url: string; src: string; region: 'ID' | 'WORLD' }[];
export type Request = (url: string, init?: RequestInit) => Promise<Response>;
export async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    const headers = new Headers(init?.headers);
    headers.set(
      'User-Agent',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    );
    if (!headers.has('Accept'))
      headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
    if (!headers.has('Accept-Language')) headers.set('Accept-Language', 'id-ID,id;q=0.9,en;q=0.8');
    const response = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status} ${new URL(url).hostname} ${init?.method ?? 'GET'}`);
    }
    return response;
  } catch (error) {
    // URLs can contain BPS_KEY. Never propagate fetch errors or response bodies.
    throw new Error(
      error instanceof Error && /^HTTP \d{3} [a-zA-Z0-9.-]+ (?:GET|POST)$/.test(error.message)
        ? error.message
        : 'Network request failed',
    );
  }
}
export function newsSources(loadTickers: () => Promise<unknown>, get: Request) {
  let tickers: Promise<Ticker[]> | undefined;
  const tag = () => (tickers ??= loadTickers().then((raw) => tickerSchema.parse(raw)));
  return FEEDS.map((feed) => ({
    id: feed.id,
    interval: 0,
    load: async () => {
      const tagger = feed.region === 'ID' ? tickerTagger(await tag()) : () => [];
      return parseRSS(await (await get(feed.url)).text(), feed, tagger);
    },
  }));
}
const bpsCopySchema = z.object({
  fetched_at: z.iso.datetime(),
  year: z.number().int(),
  body: z.string(),
});
export async function collectBPS(
  get: Request,
  key: string,
  now: Date,
  bucket: Pick<Bucket, 'get'>,
) {
  if (!key) throw new Error('BPS_KEY missing');
  const local = new Date(now.getTime() + 7 * 3600e3);
  const year = local.getUTCFullYear(),
    month = local.getUTCMonth() + 1;
  const object = await bucket.get(`bps/calendar-${year}.json`);
  if (!object) throw new Error('BPS calendar copy missing');
  const copy = bpsCopySchema.safeParse(await object.json());
  if (!copy.success) throw new Error('BPS calendar copy invalid');
  const age = now.getTime() - Date.parse(copy.data.fetched_at);
  if (copy.data.year !== year || age < 0 || age >= 3 * 3600e3)
    throw new Error('BPS calendar copy stale');
  const events = parseBPSCalendar(copy.data.body, year);
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const url = `https://webapi.bps.go.id/v1/api/list/model/pressrelease/domain/0000/key/${encodeURIComponent(key)}/year/${year}/month/${month}/page/${page}/`;
    const releases = parseBPSReleases(await (await get(url)).json());
    pages = releases.pages;
    if (pages > 10) throw new Error('Unexpected BPS pagination');
    for (const event of releases.events) {
      const id = event.url.split('/').at(-1);
      if (!events.some((e) => e.url.split('/').includes(id ?? ''))) events.push(event);
    }
  }
  if (
    !events.some(
      (e) =>
        new Date(e.ts).getTime() >= Date.UTC(year, month - 1, 1) - 7 * 3600e3 &&
        new Date(e.ts).getTime() < Date.UTC(year, month, 1) - 7 * 3600e3,
    )
  )
    throw new Error('BPS current month missing');
  return events;
}
export function calendarSources(get: Request, key: string, now: Date, bucket: Pick<Bucket, 'get'>) {
  return [
    {
      id: 'forexfactory',
      interval: 3600e3,
      load: async () => parseForexFactory(await (await get(FF_URL)).json()),
    },
    { id: 'bps', interval: 3600e3, load: () => collectBPS(get, key, now, bucket) },
    {
      id: 'bi',
      interval: 24 * 3600e3,
      load: async () =>
        parseBI(
          await (await get(BI_URL)).text(),
          new Date(now.getTime() + 7 * 3600e3).getUTCFullYear(),
        ),
    },
  ];
}
