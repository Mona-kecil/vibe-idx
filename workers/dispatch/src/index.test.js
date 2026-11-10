import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import worker from './index.js';

const env = { BPS_PROXY_TOKEN: 'worker-test-secret' };
const auth = { Authorization: `Bearer ${env.BPS_PROXY_TOKEN}` };
let upstream;
beforeEach(() => {
  upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response('upstream body', {
        status: 202,
        headers: { 'Content-Type': 'text/x-component', 'Set-Cookie': 'private=1' },
      }),
  );
});
afterEach(() => vi.restoreAllMocks());

describe('BPS proxy', () => {
  it.each([
    ['/bps/id/arc', 'GET', {}],
    ['/bps/id/arc', 'GET', { Authorization: 'Bearer wrong' }],
    ['/bps/id/arc', 'GET', { Authorization: 'Basic worker-test-secret' }],
    ['/bps/id/arc', 'PUT', auth],
    ['/bps/id/other', 'GET', auth],
    ['/bps/id/arc/extra', 'GET', auth],
    ['/bps/_next/static/', 'GET', auth],
    ['/bps/https://evil.test/', 'GET', auth],
    ['/bps/_next/static/../../../other', 'GET', auth],
    ['/id/arc', 'GET', auth],
    ['/', 'GET', auth],
  ])('rejects %s %s without contacting upstream', async (path, method, headers) => {
    const response = await worker.fetch(
      new Request(`https://proxy.test${path}`, { method, headers }),
      env,
    );
    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('fails closed when the Worker secret is missing', async () => {
    const response = await worker.fetch(
      new Request('https://proxy.test/bps/id/arc', { headers: auth }),
      {},
    );
    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([
    ['/id/arc?year=2026', 'GET'],
    ['/en/arc', 'POST'],
    ['/_next/static/chunks/app.js', 'GET'],
  ])('forwards %s %s with only permitted headers', async (path, method) => {
    const body = method === 'POST' ? '["en","2026"]' : undefined;
    const response = await worker.fetch(
      new Request(`https://proxy.test/bps${path}`, {
        method,
        headers: {
          ...auth,
          'Next-Action': 'action-id',
          'Content-Type': 'text/plain',
          Accept: 'text/x-component',
          Origin: 'https://evil.test',
          'User-Agent': 'caller-agent',
          Cookie: 'private=1',
          'X-Extra': 'discard',
        },
        body,
      }),
      env,
    );
    expect(upstream).toHaveBeenCalledOnce();
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe(`https://www.bps.go.id${path}`);
    expect(init.method).toBe(method);
    expect(init.redirect).toBe('manual');
    expect(Object.fromEntries(init.headers)).toEqual({
      accept: 'text/x-component',
      'content-type': 'text/plain',
      'next-action': 'action-id',
      origin: 'https://www.bps.go.id',
      'user-agent': expect.stringMatching(/^Mozilla\/5\.0/),
    });
    expect(init.body ? new TextDecoder().decode(init.body) : undefined).toBe(body);
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('upstream body');
    expect([...response.headers]).toEqual([['content-type', 'text/x-component']]);
  });
  it('returns redirects without following them or forwarding their location', async () => {
    upstream.mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: 'https://evil.test' } }),
    );
    const response = await worker.fetch(
      new Request('https://proxy.test/bps/id/arc', { headers: auth }),
      env,
    );
    expect(response.status).toBe(302);
    expect(response.headers.has('Location')).toBe(false);
    expect(upstream).toHaveBeenCalledOnce();
  });
});
