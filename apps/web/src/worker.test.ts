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
});
