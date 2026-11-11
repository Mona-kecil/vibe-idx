import { createBrokerHandler } from './api/_brokers';
import { defaultMeta, parseTickerCard, tickerMeta, withShareMeta } from './api/_share';
import { brokerTickerSchema } from './src/brokers';
import { report } from './worker-sentry';

type R2Object = { body: ReadableStream; httpEtag: string; writeHttpMetadata(h: Headers): void };
type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  PUBLIC: { get(key: string): Promise<R2Object | null> };
  PRIVATE: { get(key: string): Promise<R2Object | null> };
  WORKOS_CLIENT_ID: string;
};

let brokers: ((request: Request) => Promise<Response>) | undefined;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/brokers') {
    brokers ??= createBrokerHandler({
      env: { WORKOS_CLIENT_ID: env.WORKOS_CLIENT_ID },
      store: async (key) => {
        const object = await env.PRIVATE.get(key);
        return object ? new Response(object.body) : new Response(null, { status: 404 });
      },
    });
    return brokers(request);
  }
  // Google News returns 503 to Workers, so ticker news comes from the Vercel handler.
  if (url.pathname === '/api/news')
    return fetch(`https://vibe-idx.vercel.app/api/news${url.search}`);
  if (url.pathname === '/api/og') return fetch(`https://vibe-idx.vercel.app/api/og${url.search}`);
  if (url.pathname.startsWith('/api/'))
    return Response.json({ error: 'not_found' }, { status: 404 });
  if (url.pathname.startsWith('/data/')) {
    const object = await env.PUBLIC.get(url.pathname.slice('/data/'.length));
    if (!object) return new Response('Not found', { status: 404 });
    const headers = new Headers({ ETag: object.httpEtag, 'Cache-Control': 'public, max-age=60' });
    object.writeHttpMetadata(headers);
    return new Response(object.body, { headers });
  }
  if (/^\/t\/[^/]+\/?$/.test(url.pathname)) {
    const index = await env.ASSETS.fetch(new Request(new URL('/', url)));
    if (!index.ok) return new Response('Page unavailable', { status: 502 });
    const ticker = brokerTickerSchema.safeParse(url.pathname.split('/')[2]?.toUpperCase());
    let meta = defaultMeta(url.origin);
    if (ticker.success) {
      try {
        const object = await env.PUBLIC.get(`ticker/${ticker.data}.json`);
        const card = object ? parseTickerCard(await new Response(object.body).json()) : null;
        if (card?.ticker === ticker.data) meta = tickerMeta(card, url.origin);
      } catch {
        // Public data outages must not prevent the SPA from loading.
      }
    }
    return new Response(withShareMeta(await index.text(), meta), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
      },
    });
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const path = new URL(request.url).pathname;
    try {
      const response = await route(request, env);
      if (response.status >= 500)
        ctx.waitUntil(report(`${path} returned ${response.status}`, { path }));
      return response;
    } catch (error) {
      ctx.waitUntil(report(error, { path }));
      return new Response('Internal error', { status: 500 });
    }
  },
};
