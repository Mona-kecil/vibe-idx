import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { brokers, createR2 } from './brokers';
import type { R2 } from './brokers';

vi.mock('./ticks', () => ({ collectTicks: async () => ({ published: [], pending: [] }) }));

vi.mock('node:timers/promises', () => ({
  setTimeout: async (ms: number) => {
    vi.setSystemTime(Date.now() + ms);
  },
}));

async function query(sql: string) {
  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  try {
    return (await db.runAndReadAll(sql)).getRowObjectsJson();
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}

async function prices(
  data: string,
  rows: { ticker: string; date: string; volume: number; frequency?: number }[],
) {
  const path = join(data, 'parquet', 'prices');
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
  for (const year of new Set(rows.map((row) => row.date.slice(0, 4)))) {
    const values = rows
      .filter((row) => row.date.startsWith(year))
      .map((row) => `(DATE '${row.date}', '${row.ticker}', ${row.volume}, ${row.frequency ?? 10})`);
    await query(`COPY (SELECT * FROM (VALUES ${values.join(',')}) p(date, ticker, volume, frequency))
      TO '${join(path, `${year}.parquet`)}' (FORMAT PARQUET)`);
  }
}

function network(token: string) {
  const calls: URL[] = [];
  let refreshes = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push(url);
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(url.hostname).toBe('exodus.stockbit.com');
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Origin')).toBe('https://stockbit.com');
    expect(headers.get('Referer')).toBe('https://stockbit.com/');
    expect(headers.get('User-Agent')).toContain('Chrome/');
    if (url.pathname === '/login/refresh') {
      expect(init?.method).toBe('POST');
      expect(headers.get('Authorization')).toBe(`Bearer synthetic-refresh-${refreshes}`);
      refreshes++;
      return Response.json({
        data: {
          data: {
            access: { token: `synthetic-access-${refreshes}` },
            refresh: { token: `synthetic-refresh-${refreshes}` },
          },
        },
      });
    }
    expect(JSON.parse(await readFile(token, 'utf8'))).toEqual({
      access: `synthetic-access-${refreshes}`,
      refresh: `synthetic-refresh-${refreshes}`,
    });
    expect((await stat(token)).mode & 0o777).toBe(0o600);
    expect(headers.get('Authorization')).toBe(`Bearer synthetic-access-${refreshes}`);
    expect(url.pathname).toBe('/order-trade/broker/top');
    return Response.json({
      data: {
        date: { from: url.searchParams.get('from'), to: url.searchParams.get('to') },
        list: [],
      },
    });
  };
  return { calls, fetcher };
}

const roots: string[] = [];
const day = '2026-10-27';
const previous = '2026-10-26';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'brokers-'));
  roots.push(root);
  const data = join(root, 'data');
  const token = join(root, 'stockbit.json');
  const out = join(root, 'private');
  const objects = new Map<string, Buffer>();
  const events: string[] = [];
  const hooks: {
    before?: (operation: string, key: string) => Promise<void>;
    after?: (operation: string, key: string) => Promise<void>;
  } = {};
  const etag = (bytes: Buffer) => `"${createHash('sha256').update(bytes).digest('hex')}"`;
  function save(key: string, bytes: string | Buffer) {
    objects.set(key, Buffer.from(bytes));
  }
  function load(key: string) {
    const bytes = objects.get(key);
    if (!bytes) throw new Error(`Missing fake R2 object: ${key}`);
    return Buffer.from(bytes);
  }
  const r2: R2 = {
    async get(key) {
      events.push(`get ${key}`);
      await hooks.before?.('get', key);
      const bytes = objects.get(key);
      await hooks.after?.('get', key);
      return bytes ? { bytes: Buffer.from(bytes), etag: etag(bytes) } : undefined;
    },
    async put(key, bytes, condition) {
      events.push(`put ${key}`);
      await hooks.before?.('put', key);
      const current = objects.get(key);
      if (
        condition &&
        ('ifNoneMatch' in condition ? current : !current || etag(current) !== condition.ifMatch)
      )
        throw new Error(`PreconditionFailed: ${key}`);
      save(key, bytes);
      await hooks.after?.('put', key);
      return etag(bytes);
    },
    async delete(key) {
      events.push(`delete ${key}`);
      await hooks.before?.('delete', key);
      objects.delete(key);
    },
  };
  save('auth/stockbit.json', JSON.stringify({ refresh: 'synthetic-refresh-0' }));
  return {
    root,
    data,
    token,
    out,
    objects,
    events,
    hooks,
    save,
    load,
    options: { data, token, out, accountId: 'synthetic', r2, deadline: Date.now() + 330 * 60000 },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${day}T12:00:00Z`));
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('private broker pipeline', () => {
  it('rotates auth once, persists it before requests, and publishes activity concentration', async () => {
    const f = await fixture();
    await prices(f.data, [{ ticker: 'AAA', date: day, volume: 1 }]);
    const net = network(f.token);
    expect(await brokers({ ...f.options, fetcher: net.fetcher })).toEqual({
      activity: { completed: 0, pending: 0, failed: [] },
      ticks: { published: [], pending: [] },
    });
    expect(net.calls.map((url) => url.pathname)).toEqual([
      '/login/refresh',
      ...Array(3).fill('/order-trade/broker/top'),
    ]);
    expect(f.events.indexOf('put auth/stockbit.json')).toBeLessThan(
      f.events.indexOf('put parquet/broker-activity-coverage.parquet'),
    );
    expect(JSON.parse(f.load('site/market-accumulation.json').toString())).toEqual({
      date: day,
      stocks: [{ ticker: 'AAA', windows: { '1d': null, '3d': null, '5d': null } }],
    });
    expect(f.objects.has('broker-run.json')).toBe(false);
    const idle = network(f.token);
    await brokers({ ...f.options, fetcher: idle.fetcher });
    expect(idle.calls).toEqual([]);
  });

  it('keeps the completedThrough cutoff at 17:17 Jakarta', async () => {
    for (const [time, expected] of [
      ['10:16:59', previous],
      ['10:17:00', day],
    ]) {
      vi.setSystemTime(new Date(`${day}T${time}Z`));
      const f = await fixture();
      await prices(
        f.data,
        [previous, day].map((date) => ({ ticker: 'AAA', date, volume: 1 })),
      );
      const net = network(f.token);
      await brokers({ ...f.options, fetcher: net.fetcher });
      expect(net.calls[1]?.searchParams.get('from')).toBe(expected);
    }
  });

  it('makes no source call after the deadline and still publishes missing concentration', async () => {
    const f = await fixture();
    await prices(f.data, [{ ticker: 'AAA', date: day, volume: 1 }]);
    const fetcher = vi.fn<typeof fetch>();
    expect(await brokers({ ...f.options, deadline: Date.now(), fetcher })).toEqual({
      activity: { completed: 0, pending: 3, failed: [] },
      ticks: { published: [], pending: [] },
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(f.objects.has('site/market-accumulation.json')).toBe(true);
    expect(f.objects.has('broker-run.json')).toBe(false);
  });

  it('retains an unexpired run marker and refuses auth, but clears markers on handled auth or storage errors', async () => {
    for (const cut of [
      'existing-marker',
      'marker-cas',
      'auth-http',
      'auth-503',
      'auth-network',
      'auth-timeout',
      'auth-body',
      'auth-invalid',
      'auth-cas',
      'coverage',
      'site',
    ]) {
      const f = await fixture();
      await prices(f.data, [{ ticker: 'AAA', date: day, volume: 1 }]);
      if (cut === 'existing-marker')
        f.save(
          'broker-run.json',
          JSON.stringify({ id: 'other', started: Date.now(), expires: Date.now() + 3600000 }),
        );
      f.hooks.before = async (operation, key) => {
        if (cut === 'marker-cas' && operation === 'put' && key === 'broker-run.json')
          f.save(key, '{}');
        if (cut === 'auth-cas' && operation === 'put' && key === 'auth/stockbit.json')
          f.save(key, '{"refresh":"other"}');
        if (
          operation === 'put' &&
          key ===
            {
              coverage: 'parquet/broker-activity-coverage.parquet',
              site: 'site/market-accumulation.json',
            }[cut]
        )
          throw new Error('storage failed');
      };
      const net = network(f.token);
      const fetcher = vi.fn<typeof fetch>((input, init) => {
        if (cut === 'auth-http') return Promise.resolve(new Response('', { status: 429 }));
        if (cut === 'auth-503') return Promise.resolve(new Response('', { status: 503 }));
        if (cut === 'auth-network') throw new TypeError('fetch failed');
        if (cut === 'auth-timeout') throw new DOMException('timed out', 'TimeoutError');
        if (cut === 'auth-body')
          return Promise.resolve(
            new Response(
              new ReadableStream({ pull: (c) => c.error(new TypeError('body failed')) }),
            ),
          );
        if (cut === 'auth-invalid') return Promise.resolve(Response.json({ data: {} }));
        return net.fetcher(input, init);
      });
      await expect(brokers({ ...f.options, fetcher })).rejects.toThrow();
      if (cut.startsWith('auth')) expect(fetcher).toHaveBeenCalledTimes(1);
      expect(f.objects.has('broker-run.json')).toBe(
        cut === 'existing-marker' || cut === 'marker-cas',
      );
      if (cut.startsWith('auth') || cut.includes('marker'))
        expect(net.calls.filter((url) => url.pathname !== '/login/refresh')).toEqual([]);
      if (cut === 'auth-cas') {
        expect(f.load('auth/stockbit.json').toString()).toBe('{"refresh":"other"}');
        expect(JSON.parse(f.load('auth/stockbit-unsaved.json').toString())).toEqual({
          access: 'synthetic-access-1',
          refresh: 'synthetic-refresh-1',
        });
      } else expect(f.objects.has('auth/stockbit-unsaved.json')).toBe(false);
    }
  });
  it('takes over an expired or legacy marker and leaves an unexpired one alone', async () => {
    const now = Date.now();
    for (const [held, takes] of [
      [{ id: 'dead', started: now - 7200000, expires: now - 1 }, true],
      [{ id: 'github', started: now - 7 * 3600000 }, true],
      [{ id: 'github', started: now - 3600000 }, false],
      ['not json', true],
    ] as const) {
      const f = await fixture();
      await prices(f.data, [{ ticker: 'AAA', date: day, volume: 1 }]);
      const bytes = typeof held === 'string' ? held : JSON.stringify(held);
      f.save('broker-run.json', bytes);
      const net = network(f.token);
      const run = brokers({ ...f.options, fetcher: net.fetcher });
      if (takes) {
        await run;
        expect(f.objects.has('broker-run.json')).toBe(false);
      } else {
        await expect(run).rejects.toThrow('Another broker run holds broker-run.json');
        expect(f.load('broker-run.json').toString()).toBe(bytes);
        expect(net.calls).toEqual([]);
      }
    }
  });

  it('writes its own deadline into the marker', async () => {
    const f = await fixture();
    await prices(f.data, [{ ticker: 'AAA', date: day, volume: 1 }]);
    let seen: unknown;
    f.hooks.after = async (operation, key) => {
      if (operation === 'put' && key === 'broker-run.json')
        seen = JSON.parse(f.load(key).toString());
    };
    await brokers({ ...f.options, fetcher: network(f.token).fetcher });
    expect(seen).toMatchObject({ expires: f.options.deadline + 15 * 60000 });
  });

  it('recovers with the local pair when the cloud pair was revoked by an unsaved refresh', async () => {
    const f = await fixture();
    await prices(f.data, [{ ticker: 'AAA', date: day, volume: 1 }]);
    f.save('auth/stockbit.json', JSON.stringify({ refresh: 'synthetic-revoked' }));
    await writeFile(
      f.token,
      JSON.stringify({ access: 'synthetic-access-0', refresh: 'synthetic-refresh-0' }),
      { mode: 0o600 },
    );
    const net = network(f.token);
    const fetcher = vi.fn<typeof fetch>((input, init) =>
      new Headers(init?.headers).get('Authorization') === 'Bearer synthetic-revoked'
        ? Promise.resolve(new Response('', { status: 401 }))
        : net.fetcher(input, init),
    );
    await brokers({ ...f.options, fetcher });
    expect(
      fetcher.mock.calls
        .slice(0, 2)
        .map(([, init]) => new Headers(init?.headers).get('Authorization')),
    ).toEqual(['Bearer synthetic-revoked', 'Bearer synthetic-refresh-0']);
    expect(JSON.parse(f.load('auth/stockbit.json').toString())).toEqual({
      access: 'synthetic-access-1',
      refresh: 'synthetic-refresh-1',
    });
    expect(net.calls.filter((url) => url.pathname === '/order-trade/broker/top')).toHaveLength(3);
  });

  it('uses the cloud pair alone when the local file is corrupt or the failure is not a rejection', async () => {
    for (const [local, status] of [
      ['{"refresh":', 200],
      [JSON.stringify({ access: 'x', refresh: 'synthetic-local' }), 429],
    ] as const) {
      const f = await fixture();
      await prices(f.data, [{ ticker: 'AAA', date: day, volume: 1 }]);
      await writeFile(f.token, local, { mode: 0o600 });
      const net = network(f.token);
      const fetcher = vi.fn<typeof fetch>((input, init) =>
        status === 200 ? net.fetcher(input, init) : Promise.resolve(new Response('', { status })),
      );
      const run = brokers({ ...f.options, fetcher });
      if (status === 200) {
        await run;
        expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe(
          'Bearer synthetic-refresh-0',
        );
      } else {
        await expect(run).rejects.toThrow('Stockbit auth HTTP 429');
        expect(fetcher).toHaveBeenCalledTimes(1);
      }
    }
  });
});

describe('fetch R2 client', () => {
  const credentials = {
    accountId: 'synthetic',
    accessKeyId: 'synthetic-key',
    secretAccessKey: 'synthetic-secret',
  };

  it('recovers a lost create-once response only when the retried 412 has identical bytes', async () => {
    for (const identical of [true, false]) {
      const events: string[] = [];
      let attempts = 0;
      const bytes = Buffer.from('evidence');
      const fetcher: typeof fetch = async (input) => {
        if (!(input instanceof Request)) throw new Error('Expected signed request');
        events.push(input.method);
        expect(input.url).toBe(
          'https://synthetic.r2.cloudflarestorage.com/vibe-idx-private/synthetic/create-once.json',
        );
        expect(input.headers.get('Authorization')).toContain('/auto/s3/aws4_request');
        if (input.method === 'GET')
          return new Response(identical ? bytes : 'other', { headers: { ETag: '"saved"' } });
        expect(input.headers.get('If-None-Match')).toBe('*');
        expect(Buffer.from(await input.arrayBuffer())).toEqual(bytes);
        if (++attempts === 1) throw new TypeError('response lost after persistence');
        return new Response('', { status: 412 });
      };
      const pending = createR2({ ...credentials, fetcher }).put(
        'synthetic/create-once.json',
        bytes,
        { ifNoneMatch: '*' },
      );
      if (identical) await expect(pending).resolves.toBe('"saved"');
      else await expect(pending).rejects.toThrow('create-once conflict');
      expect(events).toEqual(['PUT', 'PUT', 'GET']);
    }
  });

  it('retries network, 503, and 429 failures with backoff and never reads back a successful put', async () => {
    const starts: number[] = [];
    const fetcher: typeof fetch = async (input) => {
      if (!(input instanceof Request)) throw new Error('Expected signed request');
      starts.push(Date.now());
      expect(input.method).toBe('PUT');
      expect(input.headers.get('If-Match')).toBe('"previous"');
      expect(await input.text()).toBe('replacement');
      if (starts.length === 1) throw new TypeError('network');
      if (starts.length === 2) return new Response('', { status: 503 });
      if (starts.length === 3) return new Response('', { status: 429 });
      return new Response('', { headers: { ETag: '"next"' } });
    };
    const start = Date.now();
    await expect(
      createR2({ ...credentials, fetcher }).put('broker-rpm.json', Buffer.from('replacement'), {
        ifMatch: '"previous"',
      }),
    ).resolves.toBe('"next"');
    expect(starts).toEqual([start, start + 250, start + 750, start + 1750]);
    const denied = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403 }));
    await expect(createR2({ ...credentials, fetcher: denied }).get('private')).rejects.toThrow(
      '403',
    );
    expect(denied).toHaveBeenCalledTimes(1);
    const conflict = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 412 }));
    await expect(
      createR2({ ...credentials, fetcher: conflict }).put('raw', Buffer.from('x'), {
        ifNoneMatch: '*',
      }),
    ).rejects.toThrow('412');
    expect(conflict).toHaveBeenCalledTimes(1);
    const unavailable = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('', { status: 503 }));
    await expect(createR2({ ...credentials, fetcher: unavailable }).delete('raw')).rejects.toThrow(
      '503',
    );
    expect(unavailable).toHaveBeenCalledTimes(4);
  });

  it('reads a strong ETag even where Cloudflare would compress the object', async () => {
    const fetcher: typeof fetch = async (input) => {
      if (!(input instanceof Request)) throw new Error('Expected signed request');
      const identity = input.headers.get('Accept-Encoding') === 'identity';
      return new Response('{"refresh":"r"}', {
        headers: { ETag: identity ? '"strong"' : 'W/"strong"' },
      });
    };
    expect((await createR2({ ...credentials, fetcher }).get('auth/stockbit.json'))?.etag).toBe(
      '"strong"',
    );
  });

  it('preserves ETags and bytes, handles only 404 as missing, and deletes objects', async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      if (!(input instanceof Request)) throw new Error('Expected signed request');
      const url = new URL(input.url);
      calls.push(`${input.method} ${url.pathname}`);
      if (input.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.pathname.endsWith('/missing')) return new Response('', { status: 404 });
      return new Response(Buffer.from([0, 255, 1]), { headers: { ETag: '"bytes"' } });
    };
    const r2 = createR2({ ...credentials, fetcher });
    expect(await r2.get('binary')).toEqual({ bytes: Buffer.from([0, 255, 1]), etag: '"bytes"' });
    expect(await r2.get('missing')).toBeUndefined();
    await r2.delete('binary');
    expect(calls).toHaveLength(3);
  });
});
