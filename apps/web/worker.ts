import layoutWasm from 'satori/layout.wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import { createNewsHandler } from './api/_news.js';
import { createBrokerHandler } from './api/_brokers.js';
import { assetFonts, createCardRenderer, createOgHandler } from './api/_og.js';
import { defaultMeta, tickerMeta, withShareMeta } from './api/_share.js';
import { loadBucketTickerCard } from './api/_share-data.js';
import { brokerTickerSchema } from './src/brokers.js';
import {
  createEdgeCache,
  edgeCachedCard,
  type CacheStore,
  type EdgeCache,
} from './worker-cache.js';
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
  SENTRY_DSN?: string;
};
type Ctx = { waitUntil(promise: Promise<unknown>): void };
type Fail = (error: unknown, tags?: Record<string, string>) => void;

let brokers: ((request: Request) => Promise<Response>) | undefined;
let og: ((request: Request, fail: Fail) => Promise<Response>) | undefined;

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

const fixdate =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * An IMF-fixdate in milliseconds, or NaN, so a malformed date is ignored as RFC 9110 requires. The pattern fixes
 * the form, including a four-digit year, and the toUTCString round trip rejects days that do not exist, such as
 * 31 Nov, which Date.parse would roll over.
 */
function httpDate(value: string | null) {
  if (!value || !fixdate.test(value)) return NaN;
  const time = Date.parse(value);
  return new Date(time).toUTCString() === value ? time : NaN;
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
async function publicData(request: Request, env: Env, edge: EdgeCache): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const url = new URL(request.url);
  const cacheable = request.method === 'GET';
  const key = new Request(url.origin + url.pathname);
  if (cacheable) {
    const hit = await edge.get(key);
    if (hit) return unchanged(request, hit.headers) ? notModified(hit.headers) : hit;
  }
  // A conditional miss still reads the whole object, so the next revalidation here is a hit.
  const object = await env.PUBLIC.get(url.pathname.slice('/data/'.length));
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers({ ETag: object.httpEtag, 'Cache-Control': 'public, max-age=60' });
  if (object.uploaded) headers.set('Last-Modified', object.uploaded.toUTCString());
  object.writeHttpMetadata(headers);
  const response = new Response(object.body, { headers });
  if (cacheable) {
    edge.put(key, response, headers.get('Cache-Control') ?? '');
    response.headers.set('X-Edge-Cache', 'MISS');
  }
  if (!unchanged(request, response.headers)) return response;
  void response.body?.cancel();
  return notModified(response.headers);
}

async function route(request: Request, env: Env, ctx: Ctx, fail: Fail): Promise<Response> {
  const url = new URL(request.url);
  const edge = createEdgeCache(
    () => (caches as unknown as { default: CacheStore }).default,
    ctx.waitUntil.bind(ctx),
    fail,
  );
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
  if (url.pathname === '/api/news') {
    const news = createNewsHandler({
      store: async (key) => {
        const object = await env.PUBLIC.get(key);
        return object ? new Response(object.body) : new Response(null, { status: 404 });
      },
    });
    return news(request, (cause) => fail(cause, { path: url.pathname }));
  }
  if (url.pathname === '/api/og') {
    const handler = (og ??= createOgHandler({
      render: createCardRenderer({
        layout: layoutWasm,
        resvg: resvgWasm,
        fonts: assetFonts(env.ASSETS),
      }),
      loadCard: (ticker) => loadBucketTickerCard(env.PUBLIC, ticker),
    }));
    return edgeCachedCard(request, edge, () => handler(request, fail));
  }
  if (url.pathname.startsWith('/api/'))
    return Response.json({ error: 'not_found' }, { status: 404 });
  if (url.pathname.startsWith('/data/')) return publicData(request, env, edge);
  if (/^\/t\/[^/]+\/?$/.test(url.pathname)) {
    const index = await env.ASSETS.fetch(new Request(new URL('/', url)));
    if (!index.ok) return new Response('Page unavailable', { status: 502 });
    const ticker = brokerTickerSchema.safeParse(url.pathname.split('/')[2]?.toUpperCase());
    let meta = defaultMeta(url.origin);
    if (ticker.success) {
      try {
        const card = await loadBucketTickerCard(env.PUBLIC, ticker.data);
        if (card) meta = tickerMeta(card, url.origin);
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
  async fetch(request: Request, env: Env, ctx: Ctx) {
    const path = new URL(request.url).pathname;
    let reported = false;
    const fail: Fail = (error, tags) => {
      reported = true;
      ctx.waitUntil(report(env, error, { path, ...tags }));
    };
    try {
      const response = await route(request, env, ctx, fail);
      if (response.status >= 500 && !reported) fail(`${path} returned ${response.status}`);
      return response;
    } catch (error) {
      fail(error);
      return new Response('Internal error', { status: 500 });
    }
  },
};
