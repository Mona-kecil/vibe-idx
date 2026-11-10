import { calendarSchema, newsSchema, type SourceStatus } from './contracts';
import { calendarSources, newsSources, request, type Request, type BPSProxy } from './sources';

export type Source<T> = { id: string; interval: number; load: () => Promise<T[]> };
type Publication<T> = { as_of: string; sources: Record<string, SourceStatus>; items: T[] };
export type Report = (source: string, failure: unknown) => Promise<void>;
export async function refresh<T extends { source_id: string; ts: string }>(
  sources: Source<T>[],
  previous: Publication<T> | null,
  now: Date,
  report: Report,
): Promise<Publication<T> | null> {
  let successes = 0;
  const results = await Promise.all(
    sources.map(async (source) => {
      const old = previous?.sources[source.id];
      const items = previous?.items.filter((item) => item.source_id === source.id) ?? [];
      if (
        old?.status === 'ready' &&
        old.as_of &&
        now.getTime() - Date.parse(old.as_of) < source.interval
      )
        return { id: source.id, items, status: old };
      try {
        const items = await source.load();
        successes++;
        return {
          id: source.id,
          items,
          status: {
            as_of: now.toISOString(),
            attempted_at: now.toISOString(),
            status: 'ready',
            count: items.length,
          } satisfies SourceStatus,
        };
      } catch (failure) {
        await report(source.id, failure);
        return {
          id: source.id,
          items,
          status: {
            as_of: old?.as_of ?? null,
            attempted_at: now.toISOString(),
            status: old?.as_of ? 'stale' : 'unavailable',
            count: items.length,
          } satisfies SourceStatus,
        };
      }
    }),
  );
  if (!previous && !successes) return null;
  return {
    as_of: successes ? now.toISOString() : (previous?.as_of ?? now.toISOString()),
    sources: Object.fromEntries(results.map((r) => [r.id, r.status])),
    items: results.flatMap((r) => r.items).sort((a, b) => b.ts.localeCompare(a.ts)),
  };
}
export type Bucket = {
  get(key: string): Promise<{ json(): Promise<unknown> } | null>;
  put(
    key: string,
    value: string,
    options: { httpMetadata: { contentType: string; cacheControl: string } },
  ): Promise<unknown>;
};
export async function collect({
  bucket,
  bpsKey,
  report,
  now = new Date(),
  bpsProxy,
  get = (url, init) => request(url, init, bpsProxy),
}: {
  bucket: Bucket;
  bpsKey: string;
  bpsProxy?: BPSProxy;
  report: Report;
  now?: Date;
  get?: Request;
}) {
  const options = {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'public, max-age=300',
    },
  };
  const news = async () => {
    const object = await bucket.get('news.json');
    const previous = object ? newsSchema.parse(await object.json()) : null;
    const result = await refresh(
      newsSources(async () => {
        const tickers = await bucket.get('tickers.json');
        if (!tickers) throw new Error('tickers.json missing');
        return tickers.json();
      }, get),
      previous ? { ...previous, items: previous.news } : null,
      now,
      report,
    );
    if (result)
      await bucket.put(
        'news.json',
        JSON.stringify({
          as_of: result.as_of,
          sources: result.sources,
          news: result.items,
          errors: Object.entries(result.sources)
            .filter(([, value]) => value.status !== 'ready')
            .map(([id]) => `${id} feed unavailable`),
        }),
        options,
      );
  };
  const calendar = async () => {
    const object = await bucket.get('calendar.json');
    const previous = object ? calendarSchema.parse(await object.json()) : null;
    const result = await refresh(
      calendarSources(get, bpsKey, now),
      previous ? { ...previous, items: previous.cal } : null,
      now,
      report,
    );
    if (result)
      await bucket.put(
        'calendar.json',
        JSON.stringify({
          as_of: result.as_of,
          sources: result.sources,
          cal: result.items.sort((a, b) => a.ts.localeCompare(b.ts)),
          errors: Object.entries(result.sources)
            .filter(([, value]) => value.status !== 'ready')
            .map(([id]) => `${id} calendar unavailable`),
        }),
        options,
      );
  };
  const results = await Promise.allSettled([news(), calendar()]);
  for (const [i, result] of results.entries())
    if (result.status === 'rejected')
      await report(i === 0 ? 'news-publication' : 'calendar-publication', result.reason);
}
