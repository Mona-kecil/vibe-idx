import { createBrokerHandler } from './api/_brokers.js';
import { defaultMeta, parseTickerCard, tickerMeta, withShareMeta } from './api/_share.js';
import { brokerTickerSchema } from './src/brokers.js';
import { report } from './worker-sentry.js';

type R2Object = { body: ReadableStream; httpEtag: string; writeHttpMetadata(h: Headers): void };
type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  PUBLIC: { get(key: string): Promise<R2Object | null> };
  PRIVATE: { get(key: string): Promise<R2Object | null> };
  WORKOS_CLIENT_ID: string;
  DEPLOYMENT: string;
};
type Context = { waitUntil(p: Promise<unknown>): void };
type EdgeCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

let brokers: ((request: Request) => Promise<Response>) | undefined;

// The zone's Browser Cache TTL rewrites Cache-Control on cached responses to 4 hours, so the
// object's own value travels in this header and is restored on a hit.
const sourceCacheControl = 'X-Source-Cache-Control';

const edgeCache = () => (caches as unknown as { default: EdgeCache }).default;

/**
 * R2 reads cost 250 to 430 ms, so each data center keeps a copy for the object's own
 * max-age (60 seconds unless the writer set one), the same bound browsers already apply.
 */
async function publicData(request: Request, env: Env, ctx: Context): Promise<Response> {
  const url = new URL(request.url);
  const cacheable = request.method === 'GET';
  const key = new Request(url.origin + url.pathname);
  if (cacheable) {
    const hit = await edgeCache().match(key);
    if (hit) {
      const response = new Response(hit.body, hit);
      response.headers.set(
        'Cache-Control',
        response.headers.get(sourceCacheControl) ?? 'public, max-age=60',
      );
      response.headers.delete(sourceCacheControl);
      response.headers.set('X-Edge-Cache', 'HIT');
      return response;
    }
  }
  const object = await env.PUBLIC.get(url.pathname.slice('/data/'.length));
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers({ ETag: object.httpEtag, 'Cache-Control': 'public, max-age=60' });
  object.writeHttpMetadata(headers);
  const response = new Response(object.body, { headers });
  if (!cacheable) return response;
  const copy = response.clone();
  copy.headers.set(sourceCacheControl, headers.get('Cache-Control') ?? '');
  ctx.waitUntil(edgeCache().put(key, copy));
  response.headers.set('X-Edge-Cache', 'MISS');
  return response;
}

async function route(request: Request, env: Env, ctx: Context): Promise<Response> {
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
  if (url.pathname.startsWith('/data/')) return publicData(request, env, ctx);
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
  async fetch(request: Request, env: Env, ctx: Context) {
    const path = new URL(request.url).pathname;
    try {
      const response = await route(request, env, ctx);
      if (response.status >= 500)
        ctx.waitUntil(report(env.DEPLOYMENT, `${path} returned ${response.status}`, { path }));
      return response;
    } catch (error) {
      ctx.waitUntil(report(env.DEPLOYMENT, error, { path }));
      return new Response('Internal error', { status: 500 });
    }
  },
};
