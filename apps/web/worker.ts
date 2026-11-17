import { createBrokerHandler } from './api/_brokers.js';
import { defaultMeta, parseTickerCard, tickerMeta, withShareMeta } from './api/_share.js';
import { brokerTickerSchema } from './src/brokers.js';
import { report } from './worker-sentry.js';

type R2Object = {
  httpEtag: string;
  uploaded?: Date;
  writeHttpMetadata(h: Headers): void;
  body: ReadableStream;
};
type R2Bucket = { get(key: string): Promise<R2Object | null> };
type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  PUBLIC: R2Bucket;
  PRIVATE: R2Bucket;
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

// A failing edge cache must cost a read from R2, not the request.
const cached = async (key: Request) => {
  try {
    return await edgeCache().match(key);
  } catch {
    return undefined;
  }
};
const store = async (key: Request, response: Response) => {
  try {
    await edgeCache().put(key, response);
  } catch {
    // The next read finds nothing and tries again.
  }
};

const validators = ['ETag', 'Cache-Control', 'Last-Modified', 'Age', 'X-Edge-Cache'];

/** True when If-None-Match names this ETag, comparing weakly as RFC 9110 requires. */
function matches(ifNoneMatch: string, etag: string) {
  const bare = (tag: string) => tag.trim().replace(/^W\//, '');
  return (
    ifNoneMatch.trim() === '*' || ifNoneMatch.split(',').some((tag) => bare(tag) === bare(etag))
  );
}

/** RFC 9110: If-None-Match decides when present; otherwise If-Modified-Since against Last-Modified. */
function unchanged(request: Request, headers: Headers) {
  const ifNoneMatch = request.headers.get('If-None-Match');
  const etag = headers.get('ETag');
  if (ifNoneMatch !== null) return etag !== null && matches(ifNoneMatch, etag);
  const since = httpDate(request.headers.get('If-Modified-Since'));
  const modified = httpDate(headers.get('Last-Modified'));
  return modified <= since;
}

/**
 * An IMF-fixdate in milliseconds, or NaN, so a malformed date is ignored as RFC 9110 requires. It is exactly the
 * form toUTCString prints, so a value that does not survive the round trip, such as 31 Nov, is not a date.
 */
function httpDate(value: string | null) {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) && new Date(time).toUTCString() === value ? time : NaN;
}

const notModified = (headers: Headers) => {
  const kept = new Headers();
  for (const name of validators) {
    const value = headers.get(name);
    if (value) kept.set(name, value);
  }
  return new Response(null, { status: 304, headers: kept });
};

/**
 * R2 reads cost 250 to 430 ms, so each data center keeps a copy for the object's own
 * max-age (60 seconds unless the writer set one), the same bound browsers already apply.
 */
async function publicData(request: Request, env: Env, ctx: Context): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const url = new URL(request.url);
  const cacheable = request.method === 'GET';
  const key = new Request(url.origin + url.pathname);
  if (cacheable) {
    const hit = await cached(key);
    if (hit) {
      const response = new Response(hit.body, hit);
      response.headers.set(
        'Cache-Control',
        response.headers.get(sourceCacheControl) ?? 'public, max-age=60',
      );
      response.headers.delete(sourceCacheControl);
      response.headers.set('X-Edge-Cache', 'HIT');
      return unchanged(request, response.headers) ? notModified(response.headers) : response;
    }
  }
  // A conditional miss still reads the whole object, so the next revalidation here is a hit.
  const object = await env.PUBLIC.get(url.pathname.slice('/data/'.length));
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers({ ETag: object.httpEtag, 'Cache-Control': 'public, max-age=60' });
  if (object.uploaded) headers.set('Last-Modified', object.uploaded.toUTCString());
  object.writeHttpMetadata(headers);
  const response = new Response(object.body, { headers });
  if (cacheable) {
    const copy = response.clone();
    copy.headers.set(sourceCacheControl, headers.get('Cache-Control') ?? '');
    ctx.waitUntil(store(key, copy));
    response.headers.set('X-Edge-Cache', 'MISS');
  }
  if (!unchanged(request, response.headers)) return response;
  void response.body?.cancel();
  return notModified(response.headers);
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
