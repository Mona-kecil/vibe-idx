import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { brokerTickerSchema } from '../src/brokers';

const article = z.object({
  title: z.string(),
  link: z.url().refine((url) => new URL(url).protocol === 'https:'),
  pubDate: z.string(),
  source: z.union([z.string(), z.object({ '#text': z.string() })]).optional(),
});

export async function news(request: Request, fetcher: typeof fetch = fetch) {
  if (request.method !== 'GET')
    return Response.json(
      { error: 'method_not_allowed' },
      { status: 405, headers: { Allow: 'GET' } },
    );
  const parameters = new URL(request.url).searchParams.getAll('ticker');
  const ticker = brokerTickerSchema.safeParse(parameters.length === 1 ? parameters[0] : undefined);
  if (!ticker.success) return Response.json({ error: 'invalid_ticker' }, { status: 400 });
  const url = new URL('https://news.google.com/rss/search');
  url.search = new URLSearchParams({
    q: `${ticker.data} saham when:30d`,
    hl: 'id',
    gl: 'ID',
    ceid: 'ID:id',
  }).toString();
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('News unavailable');
    const xml = await response.text();
    const parsed: unknown = new XMLParser({
      ignoreAttributes: false,
      isArray: (name) => name === 'item',
    }).parse(xml);
    const feed = z
      .object({ rss: z.object({ channel: z.object({ item: z.array(article).optional() }) }) })
      .parse(parsed);
    return Response.json(
      (feed.rss.channel.item ?? []).slice(0, 20).map((item) => ({
        title: item.title,
        url: item.link,
        published_at: item.pubDate,
        source:
          typeof item.source === 'string' ? item.source : (item.source?.['#text'] ?? 'Google News'),
      })),
      { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' } },
    );
  } catch {
    return Response.json({ error: 'unavailable' }, { status: 502 });
  }
}

export default { fetch: (request: Request) => news(request) };
