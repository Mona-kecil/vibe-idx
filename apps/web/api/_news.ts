import { z } from 'zod';
import { brokerTickerSchema } from '../src/brokers.js';

const dayMs = 24 * 60 * 60 * 1000;
const rangeSchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine(({ from, to }) => from <= to && Date.parse(to) - Date.parse(from) < 366 * dayMs);
// The Feeds job writes this file, newest article first.
const indexSchema = z.object({
  news: z.array(
    z.object({
      title: z.string(),
      url: z.url(),
      published_at: z.iso.datetime(),
      source: z.string(),
    }),
  ),
});

export type NewsStore = (key: string) => Promise<Response>;

export function createNewsHandler({
  store,
  now = Date.now,
}: {
  store: NewsStore;
  now?: () => number;
}) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'GET')
      return Response.json(
        { error: 'method_not_allowed' },
        { status: 405, headers: { Allow: 'GET' } },
      );
    const search = new URL(request.url).searchParams;
    const parameters = search.getAll('ticker');
    const ticker = brokerTickerSchema.safeParse(
      parameters.length === 1 ? parameters[0] : undefined,
    );
    if (!ticker.success) return Response.json({ error: 'invalid_ticker' }, { status: 400 });
    let range: z.infer<typeof rangeSchema> | null = null;
    if (search.has('from') || search.has('to')) {
      const from = search.getAll('from');
      const to = search.getAll('to');
      const parsed = rangeSchema.safeParse({
        from: from.length === 1 ? from[0] : undefined,
        to: to.length === 1 ? to[0] : undefined,
      });
      if (!parsed.success) return Response.json({ error: 'invalid_range' }, { status: 400 });
      range = parsed.data;
    }

    const response = await store(`news/ticker/${ticker.data}.json`).catch(() => null);
    if (!response || (!response.ok && response.status !== 404)) {
      await response?.body?.cancel();
      return Response.json({ error: 'unavailable' }, { status: 502 });
    }
    let rows: z.infer<typeof indexSchema>['news'] = [];
    if (response.ok) {
      const index = indexSchema.safeParse(await response.json().catch(() => null));
      if (!index.success) return Response.json({ error: 'unavailable' }, { status: 502 });
      rows = index.data.news;
    } else await response.body?.cancel();

    const start = range ? Date.parse(`${range.from}T00:00:00+07:00`) : now() - 30 * dayMs;
    const end = range ? Date.parse(`${range.to}T00:00:00+07:00`) + dayMs : Infinity;
    const items = rows
      .filter((row) => Date.parse(row.published_at) >= start && Date.parse(row.published_at) < end)
      .slice(0, range ? 200 : 20);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now());
    return Response.json(items, {
      headers: {
        'Cache-Control':
          range && range.to < today
            ? 'public, s-maxage=86400, stale-while-revalidate=604800'
            : 'public, s-maxage=900, stale-while-revalidate=3600',
      },
    });
  };
}
