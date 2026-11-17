import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vite-plus/test';
import { WriteConflict } from './bucket';
import { directoryBucket, r2Bucket } from './storage';
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
    fetcher.mockResolvedValueOnce(
      Response.json({ news: ['saved'] }, { headers: { etag: '"abc"' } }),
    );
    const saved = await bucket.get('news.json');
    expect(saved?.etag).toBe('"abc"');
    expect(await saved?.json()).toEqual({ news: ['saved'] });
  });
  it('signs publication writes, preserves cache metadata, and rejects failed uploads', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(null, { status: 200, headers: { etag: '"e1"' } }),
      );
    const bucket = r2Bucket({ ...config, fetcher });
    const metadata = {
      httpMetadata: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'public, max-age=300',
      },
    };
    await bucket.put('news/ticker/BBCA.json', '{}', metadata);
    const nested = fetcher.mock.calls[0]?.[0];
    if (!(nested instanceof Request)) throw new Error('Expected a signed request');
    expect(nested.url).toBe(
      `https://${config.accountId}.r2.cloudflarestorage.com/vibe-idx-public/news/ticker/BBCA.json`,
    );
    await bucket.put('calendar.json', '{"cal":[]}', metadata);
    const request = fetcher.mock.calls[1]?.[0];
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

describe('conditional writes', () => {
  const metadata = {
    httpMetadata: { contentType: 'application/json', cacheControl: 'public, max-age=300' },
  };
  const sent = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>, call: number) => {
    const request = fetcher.mock.calls[call]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a signed request');
    return request;
  };
  it('asks R2 for the version it read, or for no object, and returns the new version', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(null, { status: 200, headers: { etag: '"e2"' } }),
      );
    const bucket = r2Bucket({ ...config, fetcher });
    expect(await bucket.put('a.json', '{}', { ...metadata, only: { match: '"e1"' } })).toEqual({
      etag: '"e2"',
    });
    await bucket.put('b.json', '{}', { ...metadata, only: { absent: true } });
    await bucket.put('c.json', '{}', metadata);
    expect(sent(fetcher, 0).headers.get('if-match')).toBe('"e1"');
    expect(sent(fetcher, 0).headers.get('if-none-match')).toBeNull();
    expect(sent(fetcher, 1).headers.get('if-none-match')).toBe('*');
    expect(sent(fetcher, 2).headers.get('if-match')).toBeNull();
  });
  it('uses the object ETag rather than a compressed representation for a conditional update', async () => {
    const fetcher: typeof fetch = async (input) => {
      if (!(input instanceof Request)) throw new Error('Expected a signed request');
      if (input.method === 'GET')
        return Response.json(
          {},
          {
            headers: {
              etag: input.headers.get('accept-encoding') === 'identity' ? '"object"' : 'W/"object"',
            },
          },
        );
      return input.headers.get('if-match') === '"object"'
        ? new Response(null, { headers: { etag: '"updated"' } })
        : new Response(null, { status: 412 });
    };
    const bucket = r2Bucket({ ...config, fetcher });
    const read = await bucket.get('news/archive/2026-11.json');
    expect(
      await bucket.put('news/archive/2026-11.json', '{}', {
        ...metadata,
        only: { match: read!.etag },
      }),
    ).toEqual({ etag: '"updated"' });
  });
  it('reports a failed condition, and R2 refusing one while another write is under way, as a conflict', async () => {
    for (const status of [412, 409]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
      await expect(
        r2Bucket({ ...config, fetcher }).put('a.json', '{}', {
          ...metadata,
          only: { match: '"e1"' },
        }),
      ).rejects.toBeInstanceOf(WriteConflict);
    }
    const denied = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));
    await expect(
      r2Bucket({ ...config, fetcher: denied }).put('a.json', '{}', {
        ...metadata,
        only: { absent: true },
      }),
    ).rejects.toThrow('R2 write HTTP 403');
  });
  it('lets exactly one of several writers of a folder through on the version they all read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bucket-'));
    const bucket = directoryBucket(root);
    await bucket.put('news/a.json', '{"n":0}', metadata);
    const read = await bucket.get('news/a.json');
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((n) =>
        bucket.put('news/a.json', `{"n":${n}}`, { ...metadata, only: { match: read?.etag ?? '' } }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results
        .filter((r) => r.status === 'rejected')
        .every((r) => r.reason instanceof WriteConflict),
    ).toBe(true);
    const winner = results.findIndex((r) => r.status === 'fulfilled') + 1;
    expect(await readFile(join(root, 'news/a.json'), 'utf8')).toBe(`{"n":${winner}}`);
    const created = await Promise.allSettled(
      [1, 2, 3].map((n) =>
        bucket.put('news/b.json', `{"n":${n}}`, { ...metadata, only: { absent: true } }),
      ),
    );
    expect(created.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
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
  it('reports to Sentry only from GitHub Actions and requires the DSN there', async () => {
    const sentry: string[] = [];
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (input instanceof Request) return new Response(null, { status: 403 });
      if (String(input).includes('sentry.example')) sentry.push(String(input));
      return new Response(null, { status: 200 });
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = {
      R2_ACCOUNT_ID: config.accountId,
      R2_ACCESS_KEY_ID: config.accessKeyId,
      R2_SECRET_ACCESS_KEY: config.secretAccessKey,
      BPS_KEY: 'test-bps-key',
      SENTRY_DSN: 'https://test-public-key@sentry.example/123',
    };
    try {
      expect(await run(env)).toBe(1);
      expect(sentry).toEqual([]);
      expect(await run({ ...env, GITHUB_ACTIONS: 'true' })).toBe(1);
      expect(sentry).not.toEqual([]);
      sentry.length = 0;
      expect(await run({ ...env, GITHUB_ACTIONS: 'true', SENTRY_DSN: undefined })).toBe(1);
      expect(sentry).toEqual([]);
      expect(log.mock.calls.flat().join()).toContain(
        'Missing or invalid configuration: SENTRY_DSN',
      );
    } finally {
      fetcher.mockRestore();
      log.mockRestore();
    }
  });
});
