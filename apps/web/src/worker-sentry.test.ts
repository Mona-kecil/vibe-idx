import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { report } from '../worker-sentry';

const dsn = 'https://publickey@o1.ingest.example.io/42';

afterEach(() => vi.unstubAllGlobals());

describe('Worker error reports', () => {
  it('posts an envelope with the stack and tags to the DSN project', async () => {
    const send = vi.fn<typeof fetch>(async () => new Response('{}'));
    vi.stubGlobal('fetch', send);
    await report({ DEPLOYMENT: 'test', SENTRY_DSN: dsn }, new Error('boom'), { route: 'og' });
    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe('https://o1.ingest.example.io/api/42/envelope/');
    const { headers, body } = init as { headers: Record<string, string>; body: string };
    expect(headers['X-Sentry-Auth']).toContain('sentry_key=publickey');
    const event = JSON.parse(body.split('\n')[2] ?? '');
    expect(event.tags).toEqual({ route: 'og' });
    expect(event.environment).toBe('test');
    expect(event.extra.stack).toContain('boom');
  });

  it.each([undefined, ''])(
    'sends nothing and logs the failure without a DSN (%j)',
    async (none) => {
      const send = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', send);
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failure = new Error('boom');
      await report({ DEPLOYMENT: 'test', SENTRY_DSN: none }, failure, {});
      expect(send).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('Not reported to Sentry:', failure);
      log.mockRestore();
    },
  );
});

describe('Worker error reporting under wrangler dev', () => {
  const file = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

  it('is blanked by .dev.vars, which only wrangler dev reads', () => {
    expect(file('.dev.vars').trim().split('\n')).toEqual(['SENTRY_DSN=']);
  });
});
