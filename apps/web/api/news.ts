import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { brokerTickerSchema } from '../src/brokers.js';

const article = z.object({
  title: z.string(),
  link: z.url().refine((url) => new URL(url).protocol === 'https:'),
  pubDate: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  source: z.union([z.string(), z.object({ '#text': z.string() })]).optional(),
});

const dayMs = 24 * 60 * 60 * 1000;
const rangeSchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine(({ from, to }) => from <= to && Date.parse(to) - Date.parse(from) < 366 * dayMs);

export async function news(request: Request, fetcher: typeof fetch = fetch) {
  if (request.method !== 'GET')
    return Response.json(
      { error: 'method_not_allowed' },
      { status: 405, headers: { Allow: 'GET' } },
    );
  const search = new URL(request.url).searchParams;
  const parameters = search.getAll('ticker');
  const ticker = brokerTickerSchema.safeParse(parameters.length === 1 ? parameters[0] : undefined);
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

  const windows: string[] = [];
  if (range) {
    const end = Date.parse(range.to) + dayMs;
    for (let start = Date.parse(range.from); start < end; ) {
      const next = new Date(start);
      next.setUTCMonth(next.getUTCMonth() + 1, 1);
      const stop = Math.min(next.getTime(), end);
      // Overlap the prior UTC day to retain articles from the first Jakarta date.
      windows.push(
        `after:${new Date(start - dayMs).toISOString().slice(0, 10)} before:${new Date(stop).toISOString().slice(0, 10)}`,
      );
      start = stop;
    }
  } else {
    windows.push('when:30d');
  }

  try {
    const name = await fetcher(
      `https://pub-7982bfb066694e6e8615750132283eba.r2.dev/ticker/${ticker.data}.json`,
      { signal: AbortSignal.timeout(10000) },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('Company unavailable');
        return z
          .object({ ticker: z.literal(ticker.data), name: z.string() })
          .parse(await response.json())
          .name.replace(/\b(?:PT|Tbk|Persero)\b\.?/gi, '')
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim();
      })
      .catch(() => '');
    const query = name
      ? `("saham ${ticker.data}" OR "${ticker.data} saham" OR "${name}")`
      : `${ticker.data} saham`;
    const feeds = await Promise.all(
      windows.map(async (window) => {
        const url = new URL('https://news.google.com/rss/search');
        url.search = new URLSearchParams({
          q: `${query} ${window}`,
          hl: 'id',
          gl: 'ID',
          ceid: 'ID:id',
        }).toString();
        const response = await fetcher(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('News unavailable');
        const parsed: unknown = new XMLParser({
          ignoreAttributes: false,
          isArray: (name) => name === 'item',
        }).parse(await response.text());
        const feed = z
          .object({ rss: z.object({ channel: z.object({ item: z.array(article).optional() }) }) })
          .parse(parsed);
        return feed.rss.channel.item ?? [];
      }),
    );
    const links = new Set<string>();
    const headlines = new Set<string>();
    const start = range ? Date.parse(`${range.from}T00:00:00+07:00`) : -Infinity;
    const end = range ? Date.parse(`${range.to}T00:00:00+07:00`) + dayMs : Infinity;
    const tickerToken = new RegExp(`(?:^|[^\\p{L}\\p{N}])${ticker.data}(?=$|[^\\p{L}\\p{N}])`, 'u');
    const companyPhrase = name
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    const items = feeds
      .flat()
      .filter(
        (item) =>
          tickerToken.test(item.title) ||
          (companyPhrase !== '' &&
            ` ${item.title
              .normalize('NFKC')
              .toLowerCase()
              .replace(/[^\p{L}\p{N}]+/gu, ' ')
              .trim()} `.includes(` ${companyPhrase} `)),
      )
      .filter((item) => Date.parse(item.pubDate) >= start && Date.parse(item.pubDate) < end)
      .sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate))
      .map((item) => ({
        title: item.title,
        url: item.link,
        published_at: item.pubDate,
        source:
          typeof item.source === 'string' ? item.source : (item.source?.['#text'] ?? 'Google News'),
      }))
      .filter((item) => {
        const headline = JSON.stringify(
          [item.title, item.source].map((text) =>
            text
              .normalize('NFKC')
              .toLowerCase()
              .replace(/[^\p{L}\p{N}]+/gu, ' ')
              .trim(),
          ),
        );
        if (links.has(item.url) || headlines.has(headline)) return false;
        links.add(item.url);
        headlines.add(headline);
        return true;
      })
      .slice(0, range ? 200 : 20);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
    return Response.json(items, {
      headers: {
        'Cache-Control':
          range && range.to < today
            ? 'public, s-maxage=86400, stale-while-revalidate=604800'
            : 'public, s-maxage=900, stale-while-revalidate=3600',
      },
    });
  } catch {
    return Response.json({ error: 'unavailable' }, { status: 502 });
  }
}

export default { fetch: (request: Request) => news(request) };
