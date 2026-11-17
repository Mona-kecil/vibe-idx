import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import worker from '../worker';
import history from './ticker/fixtures/TPIA-history.json';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function environment() {
  return {
    ASSETS: { fetch: vi.fn<() => Promise<Response>>(async () => new Response('asset')) },
    PUBLIC: { get: vi.fn<(key: string) => Promise<null>>(async () => null) },
    PRIVATE: { get: vi.fn<(key: string) => Promise<null>>(async () => null) },
    WORKOS_CLIENT_ID: 'client_test',
    DEPLOYMENT: 'test',
  };
}
const dsn = 'https://publickey@o1.ingest.example.io/42';
// Sentry never answers, so a test that passes shows the Worker does not wait for it.
const sentry = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
function event(call: number) {
  const body = sentry.mock.calls[call]?.[1]?.body as string | undefined;
  return JSON.parse((body ?? '').split('\n')[2] ?? '');
}
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: vi.fn<(promise: Promise<unknown>) => void>((p) => void pending.push(p)) };
const settle = () => Promise.all(pending.splice(0));
const fontAssets = {
  fetch: vi.fn<(request: Request) => Promise<Response>>(
    async (request) =>
      new Response(
        await readFile(new URL(`../public${new URL(request.url).pathname}`, import.meta.url)),
      ),
  ),
};
const bucketCard = async () => ({
  body: Response.json({ ...history, ticker: 'BBCA', name: 'PT Bank Central Asia Tbk.' }).body!,
  httpEtag: 'etag',
  writeHttpMetadata: () => {},
});
// The Worker keeps its Ticker card handler for the life of the isolate, so these bindings are
// the same objects in every card test and only their behavior changes.
const cardEnv = {
  ...environment(),
  ASSETS: fontAssets,
  PUBLIC: { get: vi.fn<Parameters<typeof worker.fetch>[1]['PUBLIC']['get']>() },
};

function stubEdgeCache() {
  const store = new Map<string, Response>();
  vi.stubGlobal('caches', {
    default: {
      match: async (request: Request) => {
        const hit = store.get(request.url)?.clone();
        hit?.headers.set('Cache-Control', 'public, max-age=14400');
        return hit;
      },
      put: async (request: Request, response: Response) => void store.set(request.url, response),
    },
  });
  return store;
}

function stored(body: string, cacheControl?: string) {
  return {
    body: new Response(body).body!,
    httpEtag: '"etag"',
    uploaded: new Date('2026-11-17T10:00:00Z'),
    writeHttpMetadata: (headers: Headers) => {
      if (cacheControl) headers.set('Cache-Control', cacheControl);
    },
  };
}

beforeEach(() => void stubEdgeCache());
afterEach(() => {
  vi.unstubAllGlobals();
  ctx.waitUntil.mockClear();
});

describe('Worker', () => {
  it('injects ticker metadata from PUBLIC with the request origin', async () => {
    const env = {
      ...environment(),
      ASSETS: {
        fetch: vi.fn<(request: Request) => Promise<Response>>(async () => new Response(html)),
      },
      PUBLIC: {
        get: vi.fn<Parameters<typeof worker.fetch>[1]['PUBLIC']['get']>(async () => ({
          body: Response.json({ ...history, ticker: 'BBCA', name: 'PT Bank Central Asia Tbk.' })
            .body!,
          httpEtag: 'etag',
          writeHttpMetadata: () => {},
        })),
      },
    };
    const response = await worker.fetch(new Request('https://preview.test/t/bbca'), env, ctx);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>BBCA Bank Central Asia</title>');
    expect(env.PUBLIC.get.mock.calls[0]?.[0]).toBe('ticker/BBCA.json');
    expect(env.ASSETS.fetch.mock.calls[0]?.[0]?.url).toBe('https://preview.test/');
    expect(response.headers.get('cache-control')).toContain('s-maxage=300');
  });
  it('falls back to default metadata when PUBLIC is unavailable', async () => {
    const env = { ...environment(), ASSETS: { fetch: async () => new Response(html) } };
    const response = await worker.fetch(new Request('https://preview.test/t/NOPE'), env, ctx);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('content="https://preview.test/api/og"');
  });
  describe('Ticker cards', () => {
    const date = history.prices.at(-1)?.date;
    beforeEach(() => {
      cardEnv.PUBLIC.get.mockReset().mockImplementation(bucketCard);
      sentry.mockClear();
      vi.stubGlobal('fetch', sentry);
    });

    it('renders from PUBLIC with fonts from ASSETS', async () => {
      const response = await worker.fetch(
        new Request(`https://preview.test/api/og?ticker=BBCA&d=${date}`),
        cardEnv,
        ctx,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('cache-control')).toBe(
        'public, s-maxage=86400, stale-while-revalidate=604800',
      );
      const png = new DataView(await response.arrayBuffer());
      expect([png.getUint32(16), png.getUint32(20)]).toEqual([1200, 630]);
      expect(cardEnv.PUBLIC.get).toHaveBeenCalledWith('ticker/BBCA.json');
    });
    it('renders once per card and then serves from the edge cache', async () => {
      const url = `https://preview.test/api/og?ticker=BBCA&d=${date}`;
      const first = await worker.fetch(new Request(url), cardEnv, ctx);
      await settle();
      const second = await worker.fetch(new Request(url), cardEnv, ctx);
      const other = await worker.fetch(
        new Request('https://preview.test/api/og?ticker=BBCA&d=2000-01-01'),
        cardEnv,
        ctx,
      );
      expect([first, second, other].map((r) => r.headers.get('x-edge-cache'))).toEqual([
        'MISS',
        'HIT',
        'MISS',
      ]);
      expect(second.headers.get('cache-control')).toBe(first.headers.get('cache-control'));
      expect(await second.arrayBuffer()).toEqual(await first.arrayBuffer());
      expect(cardEnv.PUBLIC.get).toHaveBeenCalledTimes(2);
    });
    it('serves a card from the edge whatever other query parameters the URL carries', async () => {
      await worker.fetch(
        new Request(`https://preview.test/api/og?ticker=BBCA&d=${date}`),
        cardEnv,
        ctx,
      );
      await settle();
      const variants = [
        `ticker=bbca&d=${date}`,
        `d=${date}&ticker=BBCA`,
        `ticker=BBCA&d=${date}&utm_source=chat&cb=${Math.random()}`,
        `ticker=BBCA&d=${date}&d2=1&`,
      ];
      for (const query of variants) {
        const response = await worker.fetch(
          new Request(`https://preview.test/api/og?${query}`),
          cardEnv,
          ctx,
        );
        expect([query, response.headers.get('x-edge-cache')]).toEqual([query, 'HIT']);
      }
      expect(cardEnv.PUBLIC.get).toHaveBeenCalledOnce();
    });
    it('does not cache the brand card for an unknown ticker', async () => {
      cardEnv.PUBLIC.get.mockResolvedValue(null);
      for (let i = 0; i < 2; i++) {
        const response = await worker.fetch(
          new Request('https://preview.test/api/og?ticker=NOPE'),
          cardEnv,
          ctx,
        );
        await settle();
        expect(response.status).toBe(404);
      }
      expect(cardEnv.PUBLIC.get).toHaveBeenCalledTimes(2);
    });
    it('reports a failed render once, with its stack, and does not wait for Sentry', async () => {
      cardEnv.PUBLIC.get.mockRejectedValue(new Error('Ticker data returned 503'));
      const response = await worker.fetch(
        new Request('https://preview.test/api/og?ticker=BBCA'),
        { ...cardEnv, SENTRY_DSN: dsn },
        ctx,
      );
      expect(response.status).toBe(502);
      expect(response.headers.get('x-edge-cache')).toBe('BYPASS');
      expect(sentry).toHaveBeenCalledOnce();
      expect(ctx.waitUntil).toHaveBeenCalledOnce();
      expect(event(0).tags).toEqual({ path: '/api/og', route: 'og' });
      expect(event(0).extra.stack).toContain('Ticker data returned 503');
    });
    it('does not report to Sentry without a DSN, as under wrangler dev', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failure = new Error('Ticker data returned 503');
      cardEnv.PUBLIC.get.mockRejectedValue(failure);
      const response = await worker.fetch(
        new Request('https://preview.test/api/og?ticker=BBCA'),
        { ...cardEnv, SENTRY_DSN: '' },
        ctx,
      );
      expect(response.status).toBe(502);
      expect(sentry).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith('Not reported to Sentry:', failure);
      log.mockRestore();
    });
  });
  describe('errors', () => {
    beforeEach(() => {
      sentry.mockClear();
      vi.stubGlobal('fetch', sentry);
    });

    it('reports an error thrown by a route once, with its stack', async () => {
      const env = {
        ...environment(),
        SENTRY_DSN: dsn,
        PUBLIC: { get: vi.fn<() => Promise<never>>(() => Promise.reject(new Error('R2 down'))) },
      };
      const response = await worker.fetch(
        new Request('https://preview.test/data/a.json'),
        env,
        ctx,
      );
      expect(response.status).toBe(500);
      expect(sentry).toHaveBeenCalledOnce();
      expect(event(0).tags).toEqual({ path: '/data/a.json' });
      expect(event(0).extra.stack).toContain('R2 down');
    });
    it('reports a bare 5xx response by its path', async () => {
      const env = {
        ...environment(),
        SENTRY_DSN: dsn,
        ASSETS: { fetch: async () => new Response('', { status: 503 }) },
      };
      const response = await worker.fetch(new Request('https://preview.test/t/BBCA'), env, ctx);
      expect(response.status).toBe(502);
      expect(sentry).toHaveBeenCalledOnce();
      expect(event(0).message.formatted).toBe('/t/BBCA returned 502');
    });
  });
  it('answers ticker news from the PUBLIC archive without calling any news site', async () => {
    const network = vi.fn<typeof fetch>(async () => new Response('unexpected', { status: 500 }));
    vi.stubGlobal('fetch', network);
    try {
      const published_at = new Date().toISOString();
      const rows = [
        { title: 'Saham BBCA Menguat', url: 'https://news.test/a', published_at, source: 'Kontan' },
      ];
      const env = {
        ...environment(),
        PUBLIC: {
          get: vi.fn<(key: string) => Promise<unknown>>(async (key) =>
            key.endsWith(`/${published_at.slice(0, 4)}.json`)
              ? { body: Response.json({ ticker: 'BBCA', as_of: published_at, news: rows }).body! }
              : null,
          ),
        },
      };
      const response = await worker.fetch(
        new Request('https://preview.test/api/news?ticker=BBCA'),
        env as never,
        ctx,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(rows);
      expect(env.PUBLIC.get).toHaveBeenCalledWith(
        `news/ticker/BBCA/${published_at.slice(0, 4)}.json`,
      );
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('reports the read error behind a failed news answer once', async () => {
    const network = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', network);
    const waiting: Promise<unknown>[] = [];
    try {
      const env = {
        ...environment(),
        PUBLIC: {
          get: vi.fn<(key: string) => Promise<unknown>>(async () => {
            throw new Error('R2 down');
          }),
        },
      };
      const response = await worker.fetch(
        new Request('https://preview.test/api/news?ticker=BBCA'),
        env as never,
        { waitUntil: (promise) => void waiting.push(promise) },
      );
      expect(response.status).toBe(502);
      await Promise.all(waiting);
      expect(network).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(network.mock.calls[0]?.[1]?.body)).toContain('R2 down');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('serves public data only from PUBLIC and leaves missing objects unavailable', async () => {
    const env = environment();
    const response = await worker.fetch(
      new Request('https://preview.test/data/news.json'),
      env,
      ctx,
    );
    expect(response.status).toBe(404);
    expect(env.PUBLIC.get.mock.calls[0]?.[0]).toBe('news.json');
    expect(env.PRIVATE.get).not.toHaveBeenCalled();
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });
  it('serves a repeated public read from the edge without reading PUBLIC again', async () => {
    const env = environment();
    env.PUBLIC.get.mockResolvedValueOnce(stored('{"a":1}', 'public, max-age=300') as never);
    const pending: Promise<unknown>[] = [];
    const waiting = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
    const read = (query = '') =>
      worker.fetch(new Request(`https://idx.test/data/ticker/BBCA.json${query}`), env, waiting);

    const first = await read();
    expect(first.headers.get('x-edge-cache')).toBe('MISS');
    expect(await first.text()).toBe('{"a":1}');
    await Promise.all(pending);

    const second = await read('?cache-buster=1');
    expect(second.headers.get('x-edge-cache')).toBe('HIT');
    expect(second.headers.get('cache-control')).toBe('public, max-age=300');
    expect(second.headers.get('etag')).toBe('"etag"');
    expect(await second.text()).toBe('{"a":1}');
    expect(env.PUBLIC.get).toHaveBeenCalledTimes(1);
  });
  it('does not keep missing public objects at the edge', async () => {
    const env = environment();
    const pending: Promise<unknown>[] = [];
    const waiting = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await worker.fetch(
        new Request('https://idx.test/data/ticker/NOPE.json'),
        env,
        waiting,
      );
      expect(response.status).toBe(404);
    }
    expect(pending).toHaveLength(0);
    expect(env.PUBLIC.get).toHaveBeenCalledTimes(2);
  });
  it('answers a matching If-None-Match from the edge with 304 and the object headers', async () => {
    const env = environment();
    env.PUBLIC.get.mockResolvedValueOnce(stored('{"a":1}', 'public, max-age=300') as never);
    const pending: Promise<unknown>[] = [];
    const waiting = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
    const read = (headers: HeadersInit) =>
      worker.fetch(new Request('https://idx.test/data/market.json', { headers }), env, waiting);
    await (await read({})).text();
    await Promise.all(pending);

    const same = await read({ 'If-None-Match': '"etag"' });
    expect(same.status).toBe(304);
    expect(await same.text()).toBe('');
    expect(same.headers.get('etag')).toBe('"etag"');
    expect(same.headers.get('cache-control')).toBe('public, max-age=300');
    expect(same.headers.get('x-edge-cache')).toBe('HIT');
    expect((await read({ 'If-None-Match': 'W/"etag", "other"' })).status).toBe(304);
    expect((await read({ 'If-None-Match': '"other"' })).status).toBe(200);
    expect(env.PUBLIC.get).toHaveBeenCalledTimes(1);
  });
  it('answers a conditional miss with 304 and keeps the object at the edge for the next one', async () => {
    const env = environment();
    env.PUBLIC.get.mockResolvedValueOnce(stored('{"a":1}', 'public, max-age=300') as never);
    const pending: Promise<unknown>[] = [];
    const waiting = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
    const read = (headers: HeadersInit) =>
      worker.fetch(new Request('https://idx.test/data/market.json', { headers }), env, waiting);

    const miss = await read({ 'If-None-Match': '"etag"', Authorization: 'secret' });
    expect(env.PUBLIC.get.mock.calls[0]).toEqual(['market.json']);
    expect(miss.status).toBe(304);
    expect(miss.headers.get('etag')).toBe('"etag"');
    expect(miss.headers.get('cache-control')).toBe('public, max-age=300');
    expect(miss.headers.get('x-edge-cache')).toBe('MISS');
    await Promise.all(pending);

    const hit = await read({ 'If-None-Match': '"etag"' });
    expect(hit.status).toBe(304);
    expect(hit.headers.get('x-edge-cache')).toBe('HIT');
    expect(env.PUBLIC.get).toHaveBeenCalledTimes(1);
  });
  it('answers If-Modified-Since from Last-Modified on a miss and on a hit', async () => {
    const env = environment();
    env.PUBLIC.get.mockResolvedValueOnce(stored('{"a":1}') as never);
    const pending: Promise<unknown>[] = [];
    const waiting = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
    const read = (headers: HeadersInit) =>
      worker.fetch(new Request('https://idx.test/data/market.json', { headers }), env, waiting);
    const uploaded = 'Tue, 17 Nov 2026 10:00:00 GMT';

    const miss = await read({ 'If-Modified-Since': uploaded });
    expect(miss.status).toBe(304);
    expect(miss.headers.get('last-modified')).toBe(uploaded);
    await Promise.all(pending);

    expect((await read({ 'If-Modified-Since': uploaded })).status).toBe(304);
    expect((await read({ 'If-Modified-Since': 'Tue, 17 Nov 2026 09:59:59 GMT' })).status).toBe(200);
    expect((await read({ 'If-Modified-Since': 'not a date' })).status).toBe(200);
    expect((await read({ 'If-Modified-Since': '2099' })).status).toBe(200);
    expect((await read({ 'If-Modified-Since': '2099-01-01' })).status).toBe(200);
    expect((await read({ 'If-Modified-Since': 'Tue, 31 Nov 2099 00:00:00 GMT' })).status).toBe(200);
    expect((await read({ 'If-Modified-Since': 'Sun, 29 Feb 2099 00:00:00 GMT' })).status).toBe(200);
    expect((await read({ 'If-Modified-Since': 'Mon, 01 Jan 2099 00:00:00 GMT' })).status).toBe(200);
    expect((await read({ 'If-Modified-Since': 'Sat, 01 Jan 10000 00:00:00 GMT' })).status).toBe(
      200,
    );
    expect((await read({ 'If-Modified-Since': 'Sat, 13 Sep 275760 00:00:00 GMT' })).status).toBe(
      200,
    );
    expect((await read({ 'If-Modified-Since': 'Thu, 01 Jan 2099 00:00:00 GMT' })).status).toBe(304);
    expect((await read({ 'If-None-Match': '"other"', 'If-Modified-Since': uploaded })).status).toBe(
      200,
    );
    expect(env.PUBLIC.get).toHaveBeenCalledTimes(1);
  });
  it('ignores a malformed If-Modified-Since on a miss as well as on a hit', async () => {
    const malformed = [
      '2099',
      '2099-01-01',
      'Tue, 31 Nov 2099 00:00:00 GMT',
      'Sun, 29 Feb 2099 00:00:00 GMT',
      'Sat, 01 Jan 10000 00:00:00 GMT',
      'Sat, 13 Sep 275760 00:00:00 GMT',
    ];
    for (const [index, since] of malformed.entries()) {
      const env = environment();
      env.PUBLIC.get.mockResolvedValueOnce(stored('{"a":1}') as never);
      const response = await worker.fetch(
        new Request(`https://idx.test/data/miss-${index}.json`, {
          headers: { 'If-Modified-Since': since },
        }),
        env,
        ctx,
      );
      expect(response.headers.get('x-edge-cache')).toBe('MISS');
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('{"a":1}');
    }
  });
  it('answers only GET and HEAD for public data', async () => {
    const env = environment();
    for (const method of ['POST', 'OPTIONS', 'PUT']) {
      const response = await worker.fetch(
        new Request('https://idx.test/data/market.json', {
          method,
          headers: { 'If-None-Match': '"etag"' },
        }),
        env,
        ctx,
      );
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET, HEAD');
    }
    expect(env.PUBLIC.get).not.toHaveBeenCalled();
  });
  it('reads from PUBLIC when the edge cache throws', async () => {
    const failing = () => Promise.reject(new Error('cache down'));
    vi.stubGlobal('caches', { default: { match: failing, put: failing } });
    const env = environment();
    env.PUBLIC.get.mockResolvedValueOnce(stored('{"a":1}') as never);
    const pending: Promise<unknown>[] = [];
    const response = await worker.fetch(new Request('https://idx.test/data/market.json'), env, {
      waitUntil: (promise) => void pending.push(promise),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"a":1}');
    await expect(Promise.all(pending)).resolves.toBeDefined();
    vi.stubGlobal('caches', undefined);
    env.PUBLIC.get.mockResolvedValueOnce(stored('{"a":2}') as never);
    const noCache = await worker.fetch(new Request('https://idx.test/data/market.json'), env, ctx);
    expect(await noCache.text()).toBe('{"a":2}');
  });
  it('never caches broker responses at the edge', async () => {
    const store = stubEdgeCache();
    await worker.fetch(new Request('https://idx.test/api/brokers?ticker=BBCA'), environment(), ctx);
    expect(store.size).toBe(0);
  });
  it('reports failures under the deployment name', async () => {
    const sent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_url, init) => {
        sent.push(init?.body as string);
        return new Response(null, { status: 200 });
      }),
    );
    const pending: Promise<unknown>[] = [];
    const env = {
      ...environment(),
      DEPLOYMENT: 'production',
      SENTRY_DSN: dsn,
      ASSETS: { fetch: async () => new Response('down', { status: 503 }) },
    };
    await worker.fetch(new Request('https://idx.test/terminal'), env, {
      waitUntil: (promise) => void pending.push(promise),
    });
    await Promise.all(pending);
    expect(sent.join('')).toContain('"environment":"production"');
  });
  it('authenticates broker requests before reading PRIVATE', async () => {
    const env = environment();
    const response = await worker.fetch(
      new Request('https://preview.test/api/brokers?ticker=BBCA'),
      env,
      ctx,
    );
    expect(response.status).toBe(401);
    expect(env.PRIVATE.get).not.toHaveBeenCalled();
  });
  it('serves the terminal through assets', async () => {
    const env = environment();
    expect(
      await (await worker.fetch(new Request('https://preview.test/terminal'), env, ctx)).text(),
    ).toBe('asset');
  });
  it('returns JSON 404 for unknown API routes without an assets binding', async () => {
    const env = environment();
    const response = await worker.fetch(new Request('https://preview.test/api/foo'), env, ctx);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();

    ctx.waitUntil.mockClear();
    const probed = await worker.fetch(
      new Request('https://preview.test/api/.git/config'),
      { ...env, ASSETS: undefined as never },
      ctx,
    );
    expect(probed.status).toBe(404);
    expect(await probed.json()).toEqual({ error: 'not_found' });
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });
  describe('wrangler.jsonc', () => {
    type Target = {
      routes: { pattern: string }[];
      assets: { binding?: string; run_worker_first: string[] };
      r2_buckets: { binding: string; bucket_name: string }[];
      vars: { DEPLOYMENT: string; SENTRY_DSN: string; WORKOS_CLIENT_ID: string };
    };
    const config = JSON.parse(
      readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').replace(
        /,(\s*[}\]])/g,
        '$1',
      ),
    ) as Target & { name: string; env: { production: Target & { name: string } } };

    it.each([
      ['production', config.env.production, 'idx.monosodiums.com'],
      ['preview', config, 'preview.idx.monosodiums.com'],
    ])('binds assets, both buckets and its own domain for %s', (name, target, domain) => {
      expect(target.vars.DEPLOYMENT).toBe(name);
      expect(target.vars.SENTRY_DSN).toMatch(/^https:\/\/[^@]+@[^/]+\.sentry\.io\/\d+$/);
      expect(target.routes.map((route) => route.pattern)).toEqual([domain]);
      expect(target.assets.binding).toBe('ASSETS');
      expect(target.assets.run_worker_first).toEqual(['/api/*', '/data/*', '/t/*']);
      expect(target.r2_buckets).toEqual([
        { binding: 'PUBLIC', bucket_name: 'vibe-idx-public' },
        { binding: 'PRIVATE', bucket_name: 'vibe-idx-private' },
      ]);
    });
    it('keeps a separate WorkOS client for each environment', () => {
      expect(config.vars.WORKOS_CLIENT_ID).not.toBe(config.env.production.vars.WORKOS_CLIENT_ID);
    });
    it('makes the top level preview so a bare deploy cannot reach production', () => {
      expect(config.name).toBe('vibe-idx-preview');
      expect(config.env.production.name).toBe('vibe-idx');
    });
  });
});
