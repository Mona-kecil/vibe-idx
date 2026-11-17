import { retrying, WriteConflict, type Bucket } from './bucket';
import {
  archiveSchema,
  tickerNewsSchema,
  type ArchiveArticle,
  type TickerNewsRow,
} from './contracts';

/** The backfill's source. Its links are Google redirects, so the same story also arrives under its own link. */
export const GOOGLE_SOURCE = 'google-news';

const trackingParameter = /^(?:utm_.*|fbclid|gclid|igshid|mc_[a-z]+|ref|source|amp|amp_js_v)$/i;

/**
 * One article under any spelling of its link: https, no `www.`, tracking, fragment, trailing slash, and the AMP
 * forms of a page (`amp.` host, `/amp` path segment at either end, `?amp=1`, `?outputType=amp`).
 */
export function canonicalLink(link: string): string {
  const url = new URL(link);
  for (const [key, value] of [...url.searchParams])
    if (trackingParameter.test(key) || (/^output_?type$/i.test(key) && /^amp$/i.test(value)))
      url.searchParams.delete(key);
  url.searchParams.sort();
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length > 1 && segments.at(-1)?.toLowerCase() === 'amp') segments.pop();
  if (segments.length > 1 && segments[0]?.toLowerCase() === 'amp') segments.shift();
  const host = url.hostname.toLowerCase().replace(/^(?:(?:www|amp)\.)+/, '');
  return `${host}${segments.map((s) => `/${s}`).join('')}${url.search}`;
}

const headlineKey = (title: string) =>
  title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const publisherKey = (src: string) =>
  src
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

/** Google names a publisher more fully or more briefly than its feed does: "Antara News" and "Antara". */
const samePublisher = (a: string, b: string) => {
  const [x, y] = [publisherKey(a), publisherKey(b)];
  return x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x));
};

/** Google dates a story to within minutes of its publisher, so a day-old repeat of a headline is another story. */
const twinWindow = 6 * 3600e3;

/** Whether a Google article is the same story as a feed article: same publisher, same headline, near in time. */
const isTwin = (google: ArchiveArticle, native: ArchiveArticle) =>
  samePublisher(google.src, native.src) &&
  headlineKey(google.title) === headlineKey(native.title) &&
  Math.abs(Date.parse(google.ts) - Date.parse(native.ts)) <= twinWindow;

/** The Jakarta month an article belongs to, as `YYYY-MM`. */
export const monthOf = (ts: string) =>
  new Date(Date.parse(ts) + 7 * 3600e3).toISOString().slice(0, 7);

export const archiveKey = (month: string) => `news/archive/${month}.json`;
/** A ticker's file for the Jakarta year of `month`. */
export const tickerKey = (ticker: string, month: string) =>
  `news/ticker/${ticker}/${month.slice(0, 4)}.json`;

/** An article that entered, left or changed its tags. */
type Change = { article: ArchiveArticle; before: string[]; after: string[] };

const newest = (a: { ts: string; link: string }, b: { ts: string; link: string }) =>
  b.ts.localeCompare(a.ts) || a.link.localeCompare(b.link);
const sameTags = (a: string[], b: string[]) => a.join() === b.join();

/**
 * Merges articles into one month. A link already archived keeps its record and takes the new tags, so a better
 * tagger reaches articles a feed still lists. A Google article whose twin a feed carries (same publisher, same
 * headline, within hours) is dropped, and a feed article replaces the Google twin it duplicates. The result does
 * not depend on which arrived first.
 */
export function mergeMonth(existing: ArchiveArticle[], incoming: ArchiveArticle[]) {
  const byLink = new Map(existing.map((article) => [canonicalLink(article.link), article]));
  const byHeadline = new Map<string, Set<string>>();
  const index = (key: string, article: ArchiveArticle) => {
    const headline = headlineKey(article.title);
    byHeadline.set(headline, (byHeadline.get(headline) ?? new Set()).add(key));
  };
  for (const [key, article] of byLink) index(key, article);
  const changes: Change[] = [];
  const twins = (article: ArchiveArticle) =>
    [...(byHeadline.get(headlineKey(article.title)) ?? [])].flatMap((key) => {
      const other = byLink.get(key);
      return other ? [{ key, other }] : [];
    });
  const ordered = [...incoming].sort(
    (a, b) => Number(a.source_id === GOOGLE_SOURCE) - Number(b.source_id === GOOGLE_SOURCE),
  );
  for (const article of ordered) {
    const key = canonicalLink(article.link);
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
      if (
        twins(article).some(
          ({ other }) => other.source_id !== GOOGLE_SOURCE && isTwin(article, other),
        )
      )
        continue;
    } else
      for (const { key: otherKey, other } of twins(article))
        if (other.source_id === GOOGLE_SOURCE && isTwin(other, article)) {
          byLink.delete(otherKey);
          changes.push({ article: other, before: other.tags, after: [] });
        }
    byLink.set(key, article);
    index(key, article);
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

const options = {
  httpMetadata: {
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'public, max-age=300',
  },
};

async function readArchive(bucket: Bucket, month: string) {
  const object = await bucket.get(archiveKey(month));
  return object ? { etag: object.etag, archive: archiveSchema.parse(await object.json()) } : null;
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
 * Makes each ticker's file for the year of `month` carry the rows of that month's archive, and leaves the rows of
 * other months alone. Each file is read before the archive, and written only if it is still the version read, so a
 * concurrent writer's articles are never overwritten with an older view: the one that writes last read last.
 */
async function derive(bucket: Bucket, month: string, tickers: string[], now: Date) {
  let todo = tickers;
  let written = 0;
  for (let round = 1; todo.length; round++) {
    if (round > 12) throw new WriteConflict(tickerKey(todo[0]!, month));
    const files = new Map<string, Awaited<ReturnType<Bucket['get']>>>();
    await pool(todo, async (ticker) => {
      files.set(ticker, await bucket.get(tickerKey(ticker, month)));
    });
    const articles = (await readArchive(bucket, month))?.archive.articles ?? [];
    const conflicted: string[] = [];
    await pool(todo, async (ticker) => {
      const file = files.get(ticker) ?? null;
      const current = file ? tickerNewsSchema.parse(await file.json()).news : [];
      const news = [
        ...current.filter((row) => monthOf(row.published_at) !== month),
        ...articles.filter((article) => article.tags.includes(ticker)).map(toRow),
      ].sort(newestRow);
      if (JSON.stringify(news) === JSON.stringify(current) && (file || !news.length)) return;
      try {
        await bucket.put(
          tickerKey(ticker, month),
          JSON.stringify({ ticker, as_of: now.toISOString(), news }),
          { ...options, only: file ? { match: file.etag } : { absent: true } },
        );
        written++;
      } catch (failure) {
        if (!(failure instanceof WriteConflict)) throw failure;
        conflicted.push(ticker);
      }
    });
    todo = conflicted;
  }
  return written;
}

/**
 * Brings one month to rest: merges `incoming`, and makes the ticker files agree with the archive. The archive
 * write comes first and marks the month dirty. The ticker files follow, and a last write clears the mark, but only
 * if nobody has written the month since. So a run that dies at any write leaves either nothing changed or a dirty
 * month, and the next run to find a dirty month rebuilds every ticker file of it from the archive alone, without
 * needing the articles again. A writer that finds the month dirty rebuilds all of it rather than only its own
 * changes, which is what lets it clear a mark another writer set.
 */
async function settleMonth(bucket: Bucket, month: string, incoming: ArchiveArticle[], now: Date) {
  const written = await retrying(async () => {
    const stored = await readArchive(bucket, month);
    const merged = mergeMonth(stored?.archive.articles ?? [], incoming);
    const dirty = stored?.archive.dirty ?? false;
    if (!merged.changes.length) return stored && dirty ? { ...stored, merged, dirty } : null;
    const tickers = [
      ...new Set([
        ...(stored?.archive.tickers ?? []),
        ...merged.changes.flatMap((c) => [...c.before, ...c.after]),
        ...merged.articles.flatMap((a) => a.tags),
      ]),
    ].sort();
    const archive = {
      month,
      as_of: now.toISOString(),
      dirty: true,
      tickers,
      articles: merged.articles,
    };
    const { etag } = await bucket.put(archiveKey(month), JSON.stringify(archive), {
      ...options,
      only: stored ? { match: stored.etag } : { absent: true },
    });
    return { etag, archive, merged, dirty };
  });
  if (!written) return { changes: 0, files: 0 };
  const affected = written.dirty
    ? written.archive.tickers
    : [...new Set(written.merged.changes.flatMap((c) => [...c.before, ...c.after]))].sort();
  const files = await derive(bucket, month, affected, now);
  await bucket
    .put(archiveKey(month), JSON.stringify({ ...written.archive, dirty: false }), {
      ...options,
      only: { match: written.etag },
    })
    .catch((failure: unknown) => {
      // Someone wrote the month after us. They saw it dirty, or are about to, and will finish the job.
      if (!(failure instanceof WriteConflict)) throw failure;
    });
  return { changes: written.merged.changes.length, files };
}

/** The Jakarta month of `now` and the one before it, the months a run looks at for a failure to repair. */
export function recentMonths(now: Date) {
  const month = monthOf(now.toISOString());
  const before = new Date(Date.parse(`${month}-01T00:00:00+07:00`) - 1);
  return [monthOf(before.toISOString()), month];
}

/**
 * Merges articles into the monthly archive and brings the ticker files up to date with it. Rerunning with the same
 * articles writes nothing. `watch` names months to look at although no article belongs to them, so a month left
 * dirty by a failed run is repaired by the next run whether or not a feed still carries its articles. A month
 * that fails does not stop the others; the first failure is thrown once all have run.
 */
export async function publishArchive(
  bucket: Bucket,
  articles: ArchiveArticle[],
  now: Date,
  watch: string[] = [],
) {
  const months = new Map<string, ArchiveArticle[]>(watch.map((month) => [month, []]));
  for (const article of articles) {
    const month = monthOf(article.ts);
    months.set(month, [...(months.get(month) ?? []), article]);
  }
  const totals = { articles: 0, months: 0, tickers: 0 };
  const failures: unknown[] = [];
  for (const [month, incoming] of [...months].sort(([a], [b]) => a.localeCompare(b))) {
    try {
      const settled = await settleMonth(bucket, month, incoming, now);
      totals.articles += settled.changes;
      totals.months += settled.changes ? 1 : 0;
      totals.tickers += settled.files;
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length) throw failures[0];
  return totals;
}
