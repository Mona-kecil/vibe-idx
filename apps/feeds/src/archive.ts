import {
  archiveSchema,
  tickerNewsSchema,
  type ArchiveArticle,
  type TickerNewsRow,
} from './contracts';
import type { Bucket } from './collector';

/** The backfill's source. Its links are Google redirects, so the same story also arrives under its own link. */
export const GOOGLE_SOURCE = 'google-news';

const trackingParameter = /^(?:utm_.*|fbclid|gclid|igshid|mc_[a-z]+|ref|source)$/i;

/** One article under any spelling of its link: https, no `www.`, tracking, fragment or trailing slash. */
export function canonicalLink(link: string): string {
  const url = new URL(link);
  for (const key of [...url.searchParams.keys()])
    if (trackingParameter.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.hostname.replace(/^www\./i, '').toLowerCase()}${path}${url.search}`;
}

const headlineKey = (title: string) =>
  title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** The Jakarta month an article belongs to, as `YYYY-MM`. */
export const monthOf = (ts: string) =>
  new Date(Date.parse(ts) + 7 * 3600e3).toISOString().slice(0, 7);

export const archiveKey = (month: string) => `news/archive/${month}.json`;
export const tickerKey = (ticker: string) => `news/ticker/${ticker}.json`;

/** An article that entered, left or changed its tags. A ticker's index follows from the changes alone. */
export type Change = { article: ArchiveArticle; before: string[]; after: string[] };

const newest = (a: { ts: string; link: string }, b: { ts: string; link: string }) =>
  b.ts.localeCompare(a.ts) || a.link.localeCompare(b.link);
const sameTags = (a: string[], b: string[]) => a.join() === b.join();

/**
 * Merges articles into one month. A link already archived keeps its record and takes the new tags, so a better
 * tagger reaches articles a feed still lists. A Google link whose headline already has an article from a feed is
 * dropped, and a feed article replaces the Google one it duplicates.
 */
export function mergeMonth(existing: ArchiveArticle[], incoming: ArchiveArticle[]) {
  const byLink = new Map(existing.map((article) => [canonicalLink(article.link), article]));
  const changes: Change[] = [];
  const nativeHeadlines = new Set(
    existing.filter((a) => a.source_id !== GOOGLE_SOURCE).map((a) => headlineKey(a.title)),
  );
  const ordered = [...incoming].sort(
    (a, b) => Number(a.source_id === GOOGLE_SOURCE) - Number(b.source_id === GOOGLE_SOURCE),
  );
  for (const article of ordered) {
    const key = canonicalLink(article.link);
    const headline = headlineKey(article.title);
    const kept = byLink.get(key);
    if (kept) {
      if (!sameTags(kept.tags, article.tags)) {
        byLink.set(key, { ...kept, tags: article.tags });
        changes.push({
          article: { ...kept, tags: article.tags },
          before: kept.tags,
          after: article.tags,
        });
      }
      continue;
    }
    if (article.source_id === GOOGLE_SOURCE) {
      if (nativeHeadlines.has(headline)) continue;
    } else if (!nativeHeadlines.has(headline)) {
      nativeHeadlines.add(headline);
      for (const [other, twin] of byLink)
        if (twin.source_id === GOOGLE_SOURCE && headlineKey(twin.title) === headline) {
          byLink.delete(other);
          changes.push({ article: twin, before: twin.tags, after: [] });
        }
    }
    byLink.set(key, article);
    changes.push({ article, before: [], after: article.tags });
  }
  return { articles: [...byLink.values()].sort(newest), changes };
}

const toRow = (article: ArchiveArticle): TickerNewsRow => ({
  title: article.title,
  url: article.link,
  published_at: article.ts,
  source: article.src,
});
const newestRow = (a: TickerNewsRow, b: TickerNewsRow) =>
  b.published_at.localeCompare(a.published_at) || a.url.localeCompare(b.url);

/** One ticker's index after the changes, or null when they leave it as it is. */
function updateIndex(existing: TickerNewsRow[], ticker: string, changes: Change[]) {
  const byLink = new Map(existing.map((row) => [canonicalLink(row.url), row]));
  let changed = false;
  for (const { article, before, after } of changes) {
    const key = canonicalLink(article.link);
    if (after.includes(ticker)) {
      const row = toRow(article);
      if (JSON.stringify(byLink.get(key)) === JSON.stringify(row)) continue;
      byLink.set(key, row);
      changed = true;
    } else if (before.includes(ticker) && byLink.delete(key)) changed = true;
  }
  return changed ? [...byLink.values()].sort(newestRow) : null;
}

const options = {
  httpMetadata: {
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'public, max-age=300',
  },
};

async function read<T>(bucket: Bucket, key: string, parse: (raw: unknown) => T): Promise<T | null> {
  const object = await bucket.get(key);
  return object ? parse(await object.json()) : null;
}

/** Runs `work` over `items`, a few at a time. */
async function pool<T>(items: T[], work: (item: T) => Promise<void>, size = 8) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    }),
  );
}

/**
 * Merges articles into the monthly archive and the ticker indexes. Rerunning with the same articles writes
 * nothing. The indexes are written before the archive: an article counts as new until the archive holds it, so
 * a run that dies between the two writes is repeated by the next run, while the other order would leave an
 * article in the archive that no index ever receives.
 */
export async function publishArchive(bucket: Bucket, articles: ArchiveArticle[], now: Date) {
  const months = new Map<string, ArchiveArticle[]>();
  for (const article of articles)
    months.set(monthOf(article.ts), [...(months.get(monthOf(article.ts)) ?? []), article]);
  const merged = new Map<string, ReturnType<typeof mergeMonth>>();
  for (const [month, incoming] of months) {
    const archive = await read(bucket, archiveKey(month), (raw) => archiveSchema.parse(raw));
    const result = mergeMonth(archive?.articles ?? [], incoming);
    if (result.changes.length) merged.set(month, result);
  }
  const changes = [...merged.values()].flatMap((result) => result.changes);
  const tickers = [...new Set(changes.flatMap((c) => [...c.before, ...c.after]))].sort();
  await pool(tickers, async (ticker) => {
    const index = await read(bucket, tickerKey(ticker), (raw) => tickerNewsSchema.parse(raw));
    const news = updateIndex(index?.news ?? [], ticker, changes);
    if (news)
      await bucket.put(
        tickerKey(ticker),
        JSON.stringify({ ticker, as_of: now.toISOString(), news }),
        options,
      );
  });
  for (const [month, result] of merged)
    await bucket.put(
      archiveKey(month),
      JSON.stringify({ month, as_of: now.toISOString(), articles: result.articles }),
      options,
    );
  return { articles: changes.length, months: merged.size, tickers: tickers.length };
}
