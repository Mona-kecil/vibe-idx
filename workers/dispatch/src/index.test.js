import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import worker from './index.js';

const now = Date.parse('2026-12-31T17:10:00Z');
const controller = { cron: '*/10 * * * *', scheduledTime: now };
const action = 'c'.repeat(42);
const body = '1:[{"title":"Scheduled release","date":"2027-01-01"}]';
let upstream;
let env;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  env = {
    GITHUB_TOKEN: 'test-token',
    SENTRY_DSN: 'https://public@sentry.test/123',
    PRIVATE: { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) },
  };
  upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (url.includes('/runs?')) return Response.json({ workflow_runs: [] });
    if (url.endsWith('/dispatches') || url.startsWith('https://sentry.test/'))
      return new Response(null, { status: 204 });
    if (url === 'https://www.bps.go.id/id/arc') {
      if (init?.method === 'POST') {
        expect(init.headers['Next-Action']).toBe(action);
        expect(init.body).toBe('["id","2027"]');
        return new Response(body);
      }
      return new Response(
        '<script src="https://evil.test/x.js"></script><script src="/_next/static/chunks/new.js"></script>',
      );
    }
    if (url === 'https://www.bps.go.id/_next/static/chunks/new.js')
      return new Response(
        `(0,m.createServerReference)("${action}",m.callServer,void 0,m.findSourceMapURL,"getArcBrs")`,
      );
    throw new Error('Unexpected request');
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function scheduled() {
  const run = worker.scheduled(controller, env);
  await vi.runAllTimersAsync();
  await run;
}
const dispatched = () =>
  expect(upstream).toHaveBeenCalledWith(
    expect.stringContaining('/brokers.yml/dispatches'),
    expect.objectContaining({ method: 'POST' }),
  );

describe('scheduled BPS copy', () => {
  it.each([null, { fetched_at: new Date(now - 3600e3).toISOString(), year: 2027, body: 'old' }])(
    'stores a missing or expired copy for the Jakarta year and dispatches brokers',
    async (copy) => {
      env.PRIVATE.get.mockResolvedValue(copy ? { json: async () => copy } : null);
      await scheduled();
      expect(env.PRIVATE.get).toHaveBeenCalledWith('bps/calendar-2027.json');
      expect(env.PRIVATE.put).toHaveBeenCalledWith(
        'bps/calendar-2027.json',
        JSON.stringify({
          fetched_at: '2026-12-31T17:10:00.000Z',
          year: 2027,
          body,
        }),
        expect.objectContaining({ httpMetadata: { contentType: 'application/json' } }),
      );
      dispatched();
    },
  );
  it('skips a fresh copy without contacting BPS', async () => {
    env.PRIVATE.get.mockResolvedValue({
      json: async () => ({
        fetched_at: new Date(now - 3599e3).toISOString(),
        year: 2027,
        body,
      }),
    });
    await scheduled();
    expect(env.PRIVATE.put).not.toHaveBeenCalled();
    expect(upstream.mock.calls.some(([url]) => url.includes('bps.go.id'))).toBe(false);
    dispatched();
  });
  it('reports a BPS challenge without overwriting the copy or blocking brokers', async () => {
    const normal = upstream.getMockImplementation();
    upstream.mockImplementation((url, init) =>
      url.includes('bps.go.id')
        ? Promise.resolve(new Response('challenge', { status: 403 }))
        : normal(url, init),
    );
    await scheduled();
    dispatched();
    expect(env.PRIVATE.put).not.toHaveBeenCalled();
    expect(upstream).toHaveBeenCalledWith(
      'https://sentry.test/api/123/envelope/',
      expect.objectContaining({
        body: expect.stringContaining('BPS calendar refresh failed: BPS calendar HTTP 403'),
      }),
    );
  });
  it('finishes the BPS copy even when broker dispatch fails', async () => {
    const normal = upstream.getMockImplementation();
    upstream.mockImplementation((url, init) =>
      url.endsWith('/dispatches')
        ? Promise.resolve(new Response(null, { status: 403 }))
        : normal(url, init),
    );
    const run = worker.scheduled(controller, env).catch((error) => error);
    await vi.runAllTimersAsync();
    expect(await run).toEqual(new Error('GitHub dispatch brokers.yml HTTP 403'));
    expect(env.PRIVATE.put).toHaveBeenCalledWith(
      'bps/calendar-2027.json',
      expect.stringContaining(body.replaceAll('"', '\\"')),
      expect.anything(),
    );
  });
  it('reports failed R2 reads and still dispatches brokers', async () => {
    env.PRIVATE.get.mockRejectedValue(new Error('R2 unavailable'));
    await scheduled();
    dispatched();
    expect(env.PRIVATE.put).not.toHaveBeenCalled();
    expect(upstream).toHaveBeenCalledWith(
      'https://sentry.test/api/123/envelope/',
      expect.objectContaining({
        body: expect.stringContaining('BPS calendar refresh failed: R2 unavailable'),
      }),
    );
  });
  it('does not refresh BPS on the ingest cron', async () => {
    const run = worker.scheduled({ ...controller, cron: '17 10 * * *' }, env);
    await vi.runAllTimersAsync();
    await run;
    expect(env.PRIVATE.get).not.toHaveBeenCalled();
    expect(upstream).toHaveBeenCalledWith(
      expect.stringContaining('/ingest.yml/dispatches'),
      expect.anything(),
    );
  });
});
it.each(['/', '/bps/id/arc', '/bps/_next/static/chunks/new.js'])('returns 404 for %s', (path) => {
  const response = worker.fetch(new Request(`https://worker.test${path}`), env);
  expect(response.status).toBe(404);
  expect(upstream).not.toHaveBeenCalled();
});
