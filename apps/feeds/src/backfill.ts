import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { GOOGLE_SOURCE, publishArchive } from './archive';
import type { Bucket } from './bucket';
import { archiveSchema, type ArchiveArticle, type Ticker } from './contracts';
import { cleanHTML } from './parsers';
import { gaps, type Progress, type Window } from './progress';

const dayMs = 24 * 3600e3;
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

/** The articles of one Google News result page that `tag` tags. */
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
  return { articles };
}

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
 * `window` cut into parts of `days` days. Google answers a query with a ranked sample of its hits, so narrower
 * parts return more in all. Measured for four tickers over 12 months, one window kept 24 to 61 articles, 12 parts
 * 73 to 269 and 26 parts 111 to 341. Halving a full page until it fit took 153 requests for one ticker, so the
 * parts are fixed.
 */
export function parts(window: Window, days: number): Window[] {
  const out: Window[] = [];
  for (let from = Date.parse(window.from); from <= Date.parse(window.to); from += days * dayMs)
    out.push({
      from: day(from),
      to: day(Math.min(from + (days - 1) * dayMs, Date.parse(window.to))),
    });
  return out;
}

/** One ticker's articles over a window, a request per part. */
export async function collectTicker(
  ticker: Ticker,
  window: Window,
  days: number,
  fetchPage: Fetcher,
  tag: (text: string) => string[],
): Promise<ArchiveArticle[]> {
  const found: ArchiveArticle[] = [];
  for (const part of parts(window, days))
    found.push(...parseGoogle(await fetchPage(queryFor(ticker, part)), tag).articles);
  return found;
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
 * uses. Of each ticker only the dates `covered` does not span are asked about, so a longer window or a later day
 * adds only what is new. `finished` hears of the dates each batch covered once the batch is published, so a run
 * that dies resumes where it stopped.
 */
export async function backfill({
  bucket,
  tickers,
  window,
  fetchPage,
  tag,
  now,
  covered = {},
  days = 30,
  batch = 50,
  finished = async () => {},
  log = () => {},
}: {
  bucket: Bucket;
  tickers: Ticker[];
  window: Window;
  fetchPage: Fetcher;
  tag: (text: string) => string[];
  now: Date;
  covered?: Progress;
  days?: number;
  batch?: number;
  finished?: (done: Progress) => Promise<void>;
  log?: (line: string) => void;
}) {
  const todo = tickers.flatMap((ticker) => {
    const missing = gaps(window, covered[ticker.ticker] ?? []);
    return missing.length ? [{ ticker, missing }] : [];
  });
  const totals = { tickers: 0, articles: 0 };
  for (let at = 0; at < todo.length; at += batch) {
    const group = todo.slice(at, at + batch);
    const articles: ArchiveArticle[] = [];
    for (const { ticker, missing } of group) {
      let kept = 0;
      for (const gap of missing) {
        const start = Date.parse(`${gap.from}T00:00:00+07:00`);
        const end = Date.parse(`${gap.to}T00:00:00+07:00`) + dayMs;
        const found = (await collectTicker(ticker, gap, days, fetchPage, tag)).filter(
          (a) => Date.parse(a.ts) >= start && Date.parse(a.ts) < end,
        );
        kept += found.length;
        articles.push(...found);
      }
      log(`${ticker.ticker} ${kept}`);
    }
    const published = await publishArchive(bucket, articles, now);
    totals.tickers += group.length;
    totals.articles += published.articles;
    await finished(
      Object.fromEntries(group.map(({ ticker, missing }) => [ticker.ticker, missing])),
    );
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
