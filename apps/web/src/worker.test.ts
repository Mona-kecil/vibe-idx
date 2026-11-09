import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vite-plus/test';
import worker from '../worker';

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
    expect(config.assets.run_worker_first).toEqual(['/api/*', '/data/*']);
  });
});
