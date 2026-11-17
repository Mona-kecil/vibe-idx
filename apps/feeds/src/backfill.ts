import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { GOOGLE_SOURCE, publishArchive } from './archive';
import type { Bucket } from './collector';
import { archiveSchema, type ArchiveArticle, type Ticker } from './contracts';
import { cleanHTML } from './parsers';

const dayMs = 24 * 3600e3;
/**
 * Google answers a query with a ranked sample of its hits, never all of them, and a wider window returns a smaller
 * share (measured for one ticker: 12 months 40 items, 1 month 25). A page of this many items or more may be cut off,
 * so its window is halved until every part comes back smaller.
 */
export const PAGE = 15;

const itemSchema = z.object({
  title: z.string(),
  link: z.url(),
  pubDate: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  source: z.union([z.string(), z.object({ '#text': z.string() })]).optional(),
});
const feedSchema = z.object({
  rss: z.object({ channel: z.object({ item: z.array(z.unknown()).optional() }) }),
});

/** Google appends " - Publisher" to every headline. */
function withoutPublisher(title: string, publisher: string) {
  const suffix = ` - ${publisher}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}

/** The articles of one Google News result page, tagged by `tag`, and how many items the page held. */
export function parseGoogle(xml: string, tag: (text: string) => string[]) {
  const parsed: unknown = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    isArray: (name) => name === 'item',
  }).parse(xml);
  const items = feedSchema.parse(parsed).rss.channel.item ?? [];
  const articles = items.flatMap((raw): ArchiveArticle[] => {
    const item = itemSchema.safeParse(raw);
    if (!item.success) return [];
    const publisher = cleanHTML(
      typeof item.data.source === 'string' ? item.data.source : (item.data.source?.['#text'] ?? ''),
    );
    const title = withoutPublisher(cleanHTML(item.data.title), publisher);
    const tags = tag(title);
    if (!title || !tags.length || new URL(item.data.link).protocol !== 'https:') return [];
    return [
      {
        ts: new Date(item.data.pubDate).toISOString(),
        src: publisher || 'Google News',
        title,
        link: item.data.link,
        tags,
        source_id: GOOGLE_SOURCE,
      },
    ];
  });
  return { articles, size: items.length };
}

export type Window = { from: string; to: string };
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function queryFor(ticker: Ticker, window: Window) {
  const name = ticker.name
    .replace(/\b(?:PT|Tbk|Persero)\b\.?/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  // Google's after and before are exclusive, so widen by a day and let the caller cut at Jakarta midnights.
  const after = day(Date.parse(window.from) - dayMs);
  const before = day(Date.parse(window.to) + 2 * dayMs);
  const terms = [
    `"saham ${ticker.ticker}"`,
    `"${ticker.ticker} saham"`,
    ...(name ? [`"${name}"`] : []),
  ];
  return `(${terms.join(' OR ')}) after:${after} before:${before}`;
}

export type Fetcher = (query: string) => Promise<string>;

/**
 * One ticker's articles over a window. A page that came back full was cut off, so its window is halved until
 * every part fits or is a single day.
 */
export async function collectWindow(
  ticker: Ticker,
  window: Window,
  fetchPage: Fetcher,
  tag: (text: string) => string[],
): Promise<ArchiveArticle[]> {
  const { articles, size } = parseGoogle(await fetchPage(queryFor(ticker, window)), tag);
  const days = (Date.parse(window.to) - Date.parse(window.from)) / dayMs;
  if (size < PAGE || days < 1) return articles;
  const middle = day(Date.parse(window.from) + Math.floor(days / 2) * dayMs);
  const next = day(Date.parse(middle) + dayMs);
  return [
    ...articles,
    ...(await collectWindow(ticker, { from: window.from, to: middle }, fetchPage, tag)),
    ...(await collectWindow(ticker, { from: next, to: window.to }, fetchPage, tag)),
  ];
}

/** The Jakarta dates from `months` back to `now`. */
export function lookback(now: Date, months: number): Window {
  const to = new Date(now.getTime() + 7 * 3600e3);
  const from = new Date(to);
  from.setUTCMonth(from.getUTCMonth() - months);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const retryable = new Set([429, 500, 502, 503]);

/** A fetcher that spaces its requests out and backs off while Google refuses them. */
export function politeGoogle({
  get = fetch,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  delay = 3000,
  attempts = 5,
  log = () => {},
}: {
  get?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  delay?: number;
  attempts?: number;
  log?: (line: string) => void;
} = {}): Fetcher {
  let last = 0;
  let clock = 0;
  return async (query) => {
    const url = new URL('https://news.google.com/rss/search');
    url.search = new URLSearchParams({ q: query, hl: 'id', gl: 'ID', ceid: 'ID:id' }).toString();
    for (let attempt = 0; ; attempt++) {
      const wait = Math.max(0, last + delay - clock) + Math.floor(Math.random() * delay * 0.3);
      await sleep(wait);
      clock += wait;
      last = clock;
      const response = await get(url, { signal: AbortSignal.timeout(30000) });
      if (response.ok) return response.text();
      await response.body?.cancel();
      if (!retryable.has(response.status) || attempt + 1 >= attempts)
        throw new Error(`Google News HTTP ${response.status}`);
      const pause = Math.max(
        Number(response.headers.get('Retry-After')) * 1000 || 0,
        30000 * 2 ** attempt,
      );
      log(`Google News HTTP ${response.status}, waiting ${Math.round(pause / 1000)}s`);
      await sleep(pause);
      clock += pause;
    }
  };
}

/**
 * Fills the archive back over `window` for each ticker, a batch at a time through the same merge the Feeds job
 * uses. `done` tickers are skipped and `finished` hears of each batch once it is published, so a run that dies
 * resumes where it stopped.
 */
export async function backfill({
  bucket,
  tickers,
  window,
  fetchPage,
  tag,
  now,
  done = [],
  batch = 25,
  finished = async () => {},
  log = () => {},
}: {
  bucket: Bucket;
  tickers: Ticker[];
  window: Window;
  fetchPage: Fetcher;
  tag: (text: string) => string[];
  now: Date;
  done?: string[];
  batch?: number;
  finished?: (tickers: string[]) => Promise<void>;
  log?: (line: string) => void;
}) {
  const todo = tickers.filter((t) => !done.includes(t.ticker));
  const totals = { tickers: 0, articles: 0 };
  const start = Date.parse(`${window.from}T00:00:00+07:00`);
  const end = Date.parse(`${window.to}T00:00:00+07:00`) + dayMs;
  for (let at = 0; at < todo.length; at += batch) {
    const group = todo.slice(at, at + batch);
    const articles: ArchiveArticle[] = [];
    for (const ticker of group) {
      const found = await collectWindow(ticker, window, fetchPage, tag);
      const kept = found.filter((a) => Date.parse(a.ts) >= start && Date.parse(a.ts) < end);
      log(`${ticker.ticker} ${kept.length}`);
      articles.push(...kept);
    }
    const published = await publishArchive(bucket, articles, now);
    totals.tickers += group.length;
    totals.articles += published.articles;
    await finished(group.map((t) => t.ticker));
  }
  return totals;
}

/**
 * Re-tags the archive with `tag`, for the day the tagger changes. The archive keeps titles but not the summaries
 * a feed article was also tagged from, so a feed article keeps its tags and gains the title's; only a Google
 * article, tagged from its title alone, can lose one.
 */
export async function retag(
  bucket: Bucket,
  months: string[],
  tag: (text: string) => string[],
  now: Date,
) {
  let articles = 0;
  for (const month of months) {
    const object = await bucket.get(`news/archive/${month}.json`);
    if (!object) continue;
    const archive = archiveSchema.parse(await object.json());
    const changed = archive.articles
      .map((article) => ({
        ...article,
        tags:
          article.source_id === GOOGLE_SOURCE
            ? tag(article.title)
            : [...new Set([...article.tags, ...tag(article.title)])].sort(),
      }))
      .filter((article, i) => article.tags.join() !== archive.articles[i]?.tags.join());
    articles += (await publishArchive(bucket, changed, now)).articles;
  }
  return articles;
}
