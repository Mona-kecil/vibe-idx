import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { request } from './sources';
import { report } from './sentry';

const proxy = { url: 'https://proxy.test/', token: 'private-proxy-token' };
afterEach(() => vi.restoreAllMocks());

describe('BPS request routing', () => {
  it.each([
    ['https://www.bps.go.id/id/arc?year=2026', 'GET'],
    ['https://www.bps.go.id/_next/static/chunks/app.js', 'GET'],
    ['https://www.bps.go.id/en/arc', 'POST'],
  ])('proxies %s %s when configured', async (url, method) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const body = method === 'POST' ? '["en","2026"]' : undefined;
    await request(url, { method, body, headers: { 'Next-Action': 'action-id' } }, proxy);
    expect(fetch).toHaveBeenCalledOnce();
    const [destination, init] = fetch.mock.calls[0]!;
    expect(destination).toBe(url.replace('https://www.bps.go.id', 'https://proxy.test/bps'));
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer private-proxy-token');
    expect(headers.get('Next-Action')).toBe('action-id');
    expect(init?.method).toBe(method);
    expect(init?.body).toBe(body);
    expect(init?.redirect).toBe('manual');
  });
  it.each([
    ['https://www.bps.go.id/id/arc', undefined],
    ['https://www.bps.go.id/_next/static/chunks/app.js', undefined],
    ['https://webapi.bps.go.id/key/private-bps-key/', proxy],
    ['https://other.test/calendar', proxy],
    ['https://www.bps.go.id.evil.test/id/arc', proxy],
    ['http://www.bps.go.id/id/arc', proxy],
  ])('keeps %s direct', async (url, config) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    await request(url, undefined, config);
    expect(fetch.mock.calls[0]?.[0]).toBe(url);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(false);
  });
  it('keeps unconfigured BPS POST requests direct', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    await request('https://www.bps.go.id/id/arc', { method: 'POST', body: '["id","2026"]' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://www.bps.go.id/id/arc');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('["id","2026"]');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });
  it('preserves credential-safe HTTP errors and Sentry reporting', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(proxy.token, { status: 403 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = await request('https://www.bps.go.id/id/arc', { method: 'POST' }, proxy).catch(
      (error: unknown) => error,
    );
    expect(failure).toEqual(new Error('HTTP 403 www.bps.go.id POST'));
    fetch.mockResolvedValue(new Response(null));
    await report('https://public@sentry.test/123', 'bps', failure);
    const envelope = fetch.mock.calls.at(-1)?.[1]?.body;
    expect(envelope).toContain('HTTP 403 www.bps.go.id POST');
    expect(envelope).not.toContain(proxy.token);
    expect(log.mock.calls.flat().join()).not.toContain(proxy.token);
  });
  it('discards network errors containing either credential', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(`${proxy.token} private-bps-key`));
    await expect(request('https://www.bps.go.id/id/arc', undefined, proxy)).rejects.toThrow(
      'Network request failed',
    );
  });
});
