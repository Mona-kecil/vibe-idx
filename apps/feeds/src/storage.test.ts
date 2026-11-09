import { describe, expect, it, vi } from 'vite-plus/test';
import { r2Bucket } from './storage';
import { run } from './run';

const config = {
  accountId: 'a'.repeat(32),
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
};

describe('R2 publications', () => {
  it('distinguishes a missing publication from a denied read', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const bucket = r2Bucket({ ...config, fetcher });
    fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await bucket.get('news.json')).toBeNull();
    fetcher.mockResolvedValueOnce(new Response('Access denied', { status: 403 }));
    await expect(bucket.get('news.json')).rejects.toThrow('R2 read HTTP 403');
    fetcher.mockResolvedValueOnce(Response.json({ news: ['saved'] }));
    expect(await (await bucket.get('news.json'))?.json()).toEqual({ news: ['saved'] });
  });
  it('signs publication writes, preserves cache metadata, and rejects failed uploads', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const bucket = r2Bucket({ ...config, fetcher });
    const metadata = {
      httpMetadata: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'public, max-age=300',
      },
    };
    await bucket.put('calendar.json', '{"cal":[]}', metadata);
    const request = fetcher.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new Error('Expected a signed request');
    expect(request.url).toBe(
      `https://${config.accountId}.r2.cloudflarestorage.com/vibe-idx-public/calendar.json`,
    );
    expect(request.method).toBe('PUT');
    expect(request.headers.get('authorization')).toContain('AWS4-HMAC-SHA256');
    expect(request.headers.get('content-type')).toBe(metadata.httpMetadata.contentType);
    expect(request.headers.get('cache-control')).toBe(metadata.httpMetadata.cacheControl);
    expect(await request.text()).toBe('{"cal":[]}');
    expect(request.url).not.toContain(config.secretAccessKey);
    fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(bucket.put('calendar.json', '{}', metadata)).rejects.toThrow('R2 write HTTP 503');
  });
});

describe('scheduled collector', () => {
  it('fails the run and reports denied R2 reads without overwriting saved publications', async () => {
    const requests: Request[] = [];
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (input instanceof Request) {
        requests.push(input);
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 200 });
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(
        await run({
          R2_ACCOUNT_ID: config.accountId,
          R2_ACCESS_KEY_ID: config.accessKeyId,
          R2_SECRET_ACCESS_KEY: config.secretAccessKey,
          BPS_KEY: 'test-bps-key',
          SENTRY_DSN: 'https://test-public-key@sentry.example/123',
        }),
      ).toBe(1);
      expect(requests).toHaveLength(2);
      expect(requests.every((request) => request.method === 'GET')).toBe(true);
      expect(log.mock.calls.flat().join()).toContain('news-publication');
      expect(log.mock.calls.flat().join()).toContain('calendar-publication');
      expect(log.mock.calls.flat().join()).not.toContain(config.secretAccessKey);
    } finally {
      fetcher.mockRestore();
      log.mockRestore();
    }
  });
});
