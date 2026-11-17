import { z } from 'zod';
import { brokerTickerSchema } from '../src/brokers.js';

const dayMs = 24 * 60 * 60 * 1000;
const rangeSchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine(({ from, to }) => from <= to && Date.parse(to) - Date.parse(from) < 366 * dayMs);
// The Feeds job writes one file per ticker and Jakarta year, newest article first.
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
type Row = z.infer<typeof indexSchema>['news'][number];

const jakartaYear = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric' }).format(ms);

const reason = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

/** One ticker year: its rows, none when the file does not exist, or the reason it cannot be used. */
async function readYear(store: NewsStore, key: string): Promise<Row[]> {
  let response: Response;
  try {
    response = await store(key);
  } catch (failure) {
    throw new Error(`${key}: read failed: ${reason(failure)}`);
  }
  if (response.status === 404) {
    await response.body?.cancel();
    return [];
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${key}: read failed: HTTP ${response.status}`);
  }
  const body: unknown = await response.json().catch((failure: unknown) => {
    throw new Error(`${key}: not JSON: ${reason(failure)}`);
  });
  const parsed = indexSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `${key}: unexpected shape at ${issue?.path.join('.') || 'root'}: ${issue?.message}`,
    );
  }
  return parsed.data.news;
}

export type NewsStore = (key: string) => Promise<Response>;

export function createNewsHandler({
  store,
  now = Date.now,
}: {
  store: NewsStore;
  now?: () => number;
}) {
  /** `failed` hears of the read or parse error behind a 502, once per request. */
  return async function handle(
    request: Request,
    failed: (cause: Error) => void = () => {},
  ): Promise<Response> {
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

    const start = range ? Date.parse(`${range.from}T00:00:00+07:00`) : now() - 30 * dayMs;
    const end = range ? Date.parse(`${range.to}T00:00:00+07:00`) + dayMs : Infinity;
    // A request spans at most two Jakarta years, so it reads at most two files, each bounded to a year of one ticker.
    const years = [...new Set([jakartaYear(range ? end - 1 : now()), jakartaYear(start)])];
    let rows: Row[];
    try {
      rows = (
        await Promise.all(
          years.map((year) => readYear(store, `news/ticker/${ticker.data}/${year}.json`)),
        )
      ).flat();
    } catch (failure) {
      failed(failure instanceof Error ? failure : new Error(String(failure)));
      return Response.json({ error: 'unavailable' }, { status: 502 });
    }
    const items = rows
      .filter((row) => Date.parse(row.published_at) >= start && Date.parse(row.published_at) < end)
      .sort((a, b) => b.published_at.localeCompare(a.published_at))
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
