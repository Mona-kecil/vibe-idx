import { brokerTickerSchema } from '../src/brokers.js';
import { reportFailure } from './_sentry.js';
import { defaultMeta, tickerMeta, withShareMeta } from './_share.js';
import { loadTickerCard } from './_share-data.js';

export async function page(request: Request, fetcher: typeof fetch = fetch) {
  if (request.method !== 'GET')
    return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  const url = new URL(request.url);
  try {
    const index = await fetcher(new URL('/index.html', url), {
      signal: AbortSignal.timeout(10000),
    });
    if (!index.ok) throw new Error(`Index HTML returned ${index.status}`);
    const html = await index.text();
    const parameters = url.searchParams.getAll('ticker');
    const ticker = brokerTickerSchema.safeParse(
      parameters.length === 1 ? parameters[0]?.toUpperCase() : undefined,
    );
    const card = ticker.success
      ? await loadTickerCard(ticker.data, fetcher).catch(() => null)
      : null;
    return new Response(
      withShareMeta(html, card ? tickerMeta(card, url.origin) : defaultMeta(url.origin)),
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
        },
      },
    );
  } catch (error) {
    await reportFailure('page', error);
    return new Response('Page unavailable', { status: 502 });
  }
}

export default { fetch: (request: Request) => page(request) };
