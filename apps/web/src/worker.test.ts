import { readFileSync } from 'node:fs';
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
const ctx = { waitUntil: vi.fn<(promise: Promise<unknown>) => void>() };

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
afterEach(() => vi.unstubAllGlobals());

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
  it('proxies OG requests and preserves their query and PNG response', async () => {
    const proxy = vi.fn<typeof fetch>(
      async () => new Response('png', { headers: { 'Content-Type': 'image/png' } }),
    );
    vi.stubGlobal('fetch', proxy);
    try {
      const response = await worker.fetch(
        new Request('https://preview.test/api/og?ticker=BBCA&d=2026-11-10'),
        environment(),
        ctx,
      );
      expect(proxy).toHaveBeenCalledWith(
        'https://vibe-idx.vercel.app/api/og?ticker=BBCA&d=2026-11-10',
      );
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(await response.text()).toBe('png');
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
      vars: { DEPLOYMENT: string; WORKOS_CLIENT_ID: string };
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
