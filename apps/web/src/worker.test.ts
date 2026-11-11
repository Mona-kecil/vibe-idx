import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vite-plus/test';
import worker from '../worker';
import history from './ticker/fixtures/TPIA-history.json';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function environment() {
  return {
    ASSETS: { fetch: vi.fn<() => Promise<Response>>(async () => new Response('asset')) },
    PUBLIC: { get: vi.fn<(key: string) => Promise<null>>(async () => null) },
    PRIVATE: { get: vi.fn<(key: string) => Promise<null>>(async () => null) },
    WORKOS_CLIENT_ID: 'client_test',
  };
}
const ctx = { waitUntil: vi.fn<(promise: Promise<unknown>) => void>() };
describe('preview Worker', () => {
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
    expect(env.PUBLIC.get).toHaveBeenCalledWith('ticker/BBCA.json');
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
    expect(env.PUBLIC.get).toHaveBeenCalledWith('news.json');
    expect(env.PRIVATE.get).not.toHaveBeenCalled();
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
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
  it('binds static assets for the worker fallback', () => {
    const config = JSON.parse(
      readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').replace(
        /,(\s*[}\]])/g,
        '$1',
      ),
    ) as { assets: { binding?: string; run_worker_first: string[] } };
    expect(config.assets.binding).toBe('ASSETS');
    expect(config.assets.run_worker_first).toEqual(['/api/*', '/data/*', '/t/*']);
  });
});
