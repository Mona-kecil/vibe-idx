import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { brokerActivity } from './brokerActivity';
import { brokers } from './brokers';
import type { R2 } from './brokers';
import { compareBrokers } from './compare-brokers';

vi.mock('node:timers/promises', () => ({
  setTimeout: async (ms: number) => {
    vi.setSystemTime(Date.now() + ms);
  },
}));
const roots: string[] = [];
const day = '2026-11-09';
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function sql(text: string) {
  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  try {
    return (await db.runAndReadAll(text)).getRowObjectsJson();
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}
async function fixture() {
  const data = await mkdtemp(join(tmpdir(), 'broker-activity-'));
  roots.push(data);
  const objects = new Map<string, Buffer>();
  const r2: R2 = {
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? { bytes, etag: 'fake-etag' } : undefined;
    },
    async put(key, bytes) {
      objects.set(key, Buffer.from(bytes));
      return 'fake-etag';
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  return { data, r2, objects, deadline: Date.now() + 3600000, dates: [day] };
}
function row(ticker = 'BBRI') {
  return {
    stock_code: ticker,
    broker_code: 'XL',
    type: 'BROKER_TYPE_LOCAL',
    date: day,
    value: 54255203000,
    lot: 193037,
    avg_price: 2810.611592596238,
    freq: 7711,
  };
}
function response(rows = [row()], broker = 'XL') {
  return {
    data: {
      from: day,
      to: day,
      broker_code: broker,
      broker_activity_transaction: { brokers_buy: rows, brokers_sell: [] },
    },
  };
}
function list(url: URL, brokers = ['XL']) {
  return Response.json({
    data: {
      date: { from: url.searchParams.get('from'), to: url.searchParams.get('to') },
      list:
        url.searchParams.get('market_type') === 'MARKET_TYPE_REGULER'
          ? brokers.map((code) => ({ code }))
          : [],
    },
  });
}
it('lists dynamic brokers, collects domestic and foreign, retries 429, and resumes completed targets from fake R2', async () => {
  const f = await fixture();
  const calls: URL[] = [];
  const starts: number[] = [];
  let busy = true;
  const request = async (input: string) => {
    const url = new URL(input);
    calls.push(url);
    starts.push(Date.now());
    if (url.pathname.endsWith('/top')) return list(url);
    expect(url.searchParams.get('market_board')).toBe('MARKET_TYPE_REGULER');
    expect(url.searchParams.get('from')).toBe(day);
    expect(url.searchParams.get('to')).toBe(day);
    expect(url.searchParams.get('transaction_type')).toBe('TRANSACTION_TYPE_GROSS');
    if (busy) {
      busy = false;
      return new Response('', { status: 429 });
    }
    return Response.json(response());
  };
  expect(await brokerActivity({ ...f, request })).toEqual({ completed: 2, pending: 0, failed: [] });
  expect(
    new Set(
      calls
        .filter((u) => u.pathname.endsWith('/activity'))
        .map((u) => u.searchParams.get('investor_type')),
    ),
  ).toEqual(new Set(['INVESTOR_TYPE_DOMESTIC', 'INVESTOR_TYPE_FOREIGN']));
  expect(starts.every((v, i) => i === 0 || v - starts[i - 1] >= 100)).toBe(true);
  const domestic = calls.flatMap((u, i) =>
    u.searchParams.get('investor_type') === 'INVESTOR_TYPE_DOMESTIC' ? [starts[i]] : [],
  );
  expect(domestic[1] - domestic[0]).toBeGreaterThanOrEqual(1000);
  const rows = await sql(
    `SELECT shares,broker_type FROM read_parquet('${f.data}/parquet/broker_activity/*.parquet')`,
  );
  expect(rows).toEqual([
    { shares: 19303700, broker_type: 'local' },
    { shares: 19303700, broker_type: 'local' },
  ]);
  await rm(join(f.data, 'parquet'), { recursive: true });
  for (const [key, bytes] of f.objects) {
    const path = join(f.data, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  calls.length = 0;
  expect(await brokerActivity({ ...f, request })).toEqual({ completed: 0, pending: 0, failed: [] });
  expect(calls).toHaveLength(0);
});
it('reads another page when either side reaches 3000 rows', async () => {
  const f = await fixture();
  const pages: string[] = [];
  const request = async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/top')) return list(url);
    pages.push(url.searchParams.get('page') ?? '');
    return Response.json(
      response(
        url.searchParams.get('page') === '1'
          ? Array.from({ length: 3000 }, (_, i) => row(`T${i}`))
          : [row('LAST')],
      ),
    );
  };
  expect((await brokerActivity({ ...f, request })).completed).toBe(2);
  expect(pages.sort()).toEqual(['1', '1', '2', '2']);
  expect(
    await sql(
      `SELECT count(*)::INTEGER n FROM read_parquet('${f.data}/parquet/broker_activity/*.parquet')`,
    ),
  ).toEqual([{ n: 6002 }]);
});
it('keeps invalid targets pending while others finish, then retries only the failed target', async () => {
  for (const invalid of [
    'date',
    'broker',
    'type',
    'negative',
    'infinite',
    'duplicate',
    'list-date',
  ]) {
    const f = await fixture();
    let broken = true;
    const calls: string[] = [];
    const request = async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/top')) {
        if (
          broken &&
          invalid === 'list-date' &&
          url.searchParams.get('market_type') === 'MARKET_TYPE_REGULER'
        )
          return Response.json({
            data: { date: { from: day, to: '2026-11-08' }, list: [{ code: 'XL' }] },
          });
        return list(url);
      }
      const investor = url.searchParams.get('investor_type') ?? '';
      calls.push(investor);
      const r = row();
      const result = response([r]);
      if (broken && investor === 'INVESTOR_TYPE_DOMESTIC') {
        if (invalid === 'date') r.date = '2026-11-08';
        if (invalid === 'broker') result.data.broker_code = 'AK';
        if (invalid === 'type') r.type = 'UNKNOWN';
        if (invalid === 'negative') r.lot = -1;
        if (invalid === 'infinite') r.lot = Infinity;
        if (invalid === 'duplicate') result.data.broker_activity_transaction.brokers_buy.push(r);
      }
      return Response.json(result);
    };
    const result = await brokerActivity({ ...f, request });
    expect(result.failed).toHaveLength(1);
    expect(result.pending).toBe(1);
    expect(result.completed).toBe(invalid === 'list-date' ? 0 : 1);
    broken = false;
    calls.length = 0;
    expect((await brokerActivity({ ...f, request })).pending).toBe(0);
    expect(calls).toHaveLength(invalid === 'list-date' ? 2 : 1);
  }
});
it('marks empty holiday lists listed without creating targets', async () => {
  const f = await fixture();
  const request = vi.fn(async (input: string) => list(new URL(input), []));
  expect(await brokerActivity({ ...f, request })).toEqual({ completed: 0, pending: 0, failed: [] });
  expect(request).toHaveBeenCalledTimes(3);
  expect(
    await sql(
      `SELECT count(*)::INTEGER n FROM read_parquet('${f.data}/parquet/broker-activity-coverage.parquet') WHERE listed`,
    ),
  ).toEqual([{ n: 3 }]);
});
it('shares one token refresh with the concurrent per-stock phase', async () => {
  const f = await fixture();
  f.objects.set('auth/stockbit.json', Buffer.from('{"refresh":"fake-refresh"}'));
  await mkdir(join(f.data, 'parquet', 'prices'), { recursive: true });
  await sql(
    `COPY (SELECT DATE '${day}' date,'BBRI' ticker,19303700 volume,1 frequency) TO '${f.data}/parquet/prices/2026.parquet' (FORMAT PARQUET)`,
  );
  let activityStarted: () => void = () => {};
  const concurrent = new Promise<void>((resolve) => {
    activityStarted = resolve;
  });
  let refreshes = 0;
  let stockCalls = 0;
  let activityCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname === '/login/refresh') {
      refreshes++;
      return Response.json({
        data: { access: { token: 'fake-access' }, refresh: { token: 'fake-next' } },
      });
    }
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fake-access');
    if (url.pathname.endsWith('/top')) return list(url);
    if (url.pathname.endsWith('/activity')) {
      activityCalls++;
      activityStarted();
      return Response.json(response());
    }
    stockCalls++;
    await concurrent;
    return Response.json({
      data: {
        from: day,
        to: day,
        bandar_detector: { total_buyer: 0, total_seller: 0 },
        broker_summary: { symbol: 'BBRI', brokers_buy: [], brokers_sell: [] },
      },
    });
  };
  const result = await brokers({
    ...f,
    token: join(f.data, 'token.json'),
    out: join(f.data, 'out'),
    accountId: 'fake',
    fetcher,
  });
  expect(refreshes).toBe(1);
  expect(stockCalls).toBe(3);
  expect(activityCalls).toBe(2);
  expect(result.activity?.completed).toBe(2);
});
it('compares complete parquet fixtures, reports mismatches, and excludes incomplete days', async () => {
  const f = await fixture();
  await brokerActivity({
    ...f,
    request: async (input) => {
      const url = new URL(input);
      return url.pathname.endsWith('/top') ? list(url) : Response.json(response());
    },
  });
  await mkdir(join(f.data, 'parquet', 'brokers'), { recursive: true });
  await mkdir(join(f.data, 'parquet', 'prices'), { recursive: true });
  await sql(`COPY (SELECT date,ticker,board,side,broker,'Lokal' investor_type,sum(shares) shares,sum(value) AS value,0 avg_price,sum(freq) freq FROM read_parquet('${f.data}/parquet/broker_activity/*.parquet') GROUP BY ALL) TO '${f.data}/parquet/brokers/2026.parquet' (FORMAT PARQUET);
    COPY (SELECT DATE '${day}' date,'BBRI' ticker,'regular' board,true complete) TO '${f.data}/parquet/broker-coverage.parquet' (FORMAT PARQUET);
    COPY (SELECT DATE '${day}' date,'BBRI' ticker,38607400 volume) TO '${f.data}/parquet/prices/2026.parquet' (FORMAT PARQUET)`);
  const matched = await compareBrokers(f.data);
  expect(matched.failed).toBe(false);
  expect(matched.dates).toEqual([
    { date: day, matched: 1, mismatched: 0, only_in_activity: 0, only_in_brokers: 0 },
  ]);
  expect(matched.volumeMismatches).toEqual([]);
  const cli = fileURLToPath(new URL('./compare-brokers.ts', import.meta.url));
  const matchOutput = await promisify(execFile)(process.execPath, [
    '--import',
    'tsx',
    cli,
    '--data',
    f.data,
  ]);
  expect(JSON.parse(matchOutput.stdout).failed).toBe(false);
  const file = join(f.data, 'parquet', 'brokers', '2026.parquet');
  await sql(
    `CREATE TABLE b AS SELECT * FROM read_parquet('${file}'); UPDATE b SET value=value+1000; COPY b TO '${file}' (FORMAT PARQUET)`,
  );
  const mismatch = await compareBrokers(f.data);
  expect(mismatch.failed).toBe(true);
  expect(mismatch.dates[0].mismatched).toBe(1);
  await expect(
    promisify(execFile)(process.execPath, ['--import', 'tsx', cli, '--data', f.data]),
  ).rejects.toMatchObject({ code: 1 });
  await sql(`CREATE TABLE b AS SELECT * FROM read_parquet('${file}');
    UPDATE b SET side='sell'; COPY b TO '${file}' (FORMAT PARQUET)`);
  const oneSided = await compareBrokers(f.data);
  expect(oneSided.failed).toBe(true);
  expect(oneSided.dates[0]).toMatchObject({ only_in_activity: 1, only_in_brokers: 1 });
  await sql(
    `COPY (SELECT DATE '${day}' date,'BBRI' ticker,'regular' board,false complete) TO '${f.data}/parquet/broker-coverage.parquet' (FORMAT PARQUET)`,
  );
  expect((await compareBrokers(f.data)).comparableDays).toBe(0);
  expect(
    (await readFile(join(f.data, 'parquet', 'broker-activity-coverage.parquet'))).length,
  ).toBeGreaterThan(0);
});

it('replaces rows left by a checkpoint that crashed before coverage upload', async () => {
  const f = await fixture();
  const request = async (input: string) => {
    const url = new URL(input);
    return url.pathname.endsWith('/top') ? list(url) : Response.json(response());
  };
  await brokerActivity({ ...f, request });
  const coverage = join(f.data, 'parquet', 'broker-activity-coverage.parquet');
  await sql(`CREATE TABLE c AS SELECT * FROM read_parquet('${coverage}');
    UPDATE c SET complete=false WHERE investor='domestic';
    COPY c TO '${coverage}' (FORMAT PARQUET)`);
  expect(await brokerActivity({ ...f, request })).toEqual({ completed: 1, pending: 0, failed: [] });
  expect(
    await sql(
      `SELECT count(*)::INTEGER n FROM read_parquet('${f.data}/parquet/broker_activity/*.parquet')`,
    ),
  ).toEqual([{ n: 2 }]);
});
it('bounds busy retries and backs off on low remaining budget', async () => {
  const f = await fixture();
  const activityStarts: number[] = [];
  const result = await brokerActivity({
    ...f,
    request: async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/top')) return list(url);
      activityStarts.push(Date.now());
      if (url.searchParams.get('investor_type') === 'INVESTOR_TYPE_DOMESTIC')
        return new Response('', { status: 503 });
      return Response.json(response(), { headers: { 'x-rate-limit-remaining': '2' } });
    },
  });
  expect(result.completed).toBe(1);
  expect(result.failed).toHaveLength(1);
  expect(activityStarts).toHaveLength(5);
  expect(activityStarts[activityStarts.length - 1] - activityStarts[0]).toBeGreaterThanOrEqual(
    3000,
  );
});
