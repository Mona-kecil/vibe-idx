import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { BrokerRunError, brokers, createR2 } from './brokers';
import type { R2 } from './brokers';

vi.mock('node:timers/promises', () => ({
  setTimeout: async (ms: number) => {
    vi.setSystemTime(Date.now() + ms);
  },
}));

function summary(ticker: string, day: string, empty = false) {
  return {
    data: {
      from: day,
      to: day,
      bandar_detector: { total_buyer: empty ? 0 : 1, total_seller: empty ? 0 : 1 },
      broker_summary: {
        symbol: ticker,
        brokers_buy: empty
          ? []
          : [
              {
                netbs_broker_code: 'AA',
                netbs_date: day.replaceAll('-', ''),
                netbs_stock_code: ticker,
                blot: '12.5',
                blotv: '1.25e3',
                bval: '6.25e5',
                bvalv: '999',
                netbs_buy_avg_price: '500',
                type: 'Asing',
                freq: '3',
              },
            ],
        brokers_sell: empty
          ? []
          : [
              {
                netbs_broker_code: 'BB',
                netbs_date: day.replaceAll('-', ''),
                netbs_stock_code: ticker,
                slot: '5',
                slotv: '5e2',
                sval: '2.55e5',
                svalv: '888',
                netbs_sell_avg_price: '510',
                type: 'Lokal',
                freq: '2',
              },
            ],
      },
    },
  };
}

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

function network(
  token: string,
  respond: (ticker: string, day: string) => Response | Promise<Response>,
) {
  const calls: string[] = [];
  let refreshes = 0;
  const starts: number[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    starts.push(Date.now());
    const url = new URL(input instanceof Request ? input.url : input);
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(url.hostname).toBe('exodus.stockbit.com');
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Origin')).toBe('https://stockbit.com');
    expect(headers.get('Referer')).toBe('https://stockbit.com/');
    expect(headers.get('User-Agent')).toContain('Chrome/');
    if (url.pathname === '/login/refresh') {
      calls.push(url.pathname);
      expect(init?.method).toBe('POST');
      expect(init?.body == null || init.body === '').toBe(true);
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
    const ticker = url.pathname.slice('/marketdetectors/'.length);
    const day = url.searchParams.get('from');
    if (!day) throw new Error('Missing broker date');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: day,
      to: day,
      transaction_type: 'TRANSACTION_TYPE_GROSS',
      market_board: 'MARKET_BOARD_ALL',
      investor_type: 'INVESTOR_TYPE_ALL',
      limit: '200',
    });
    calls.push(`${ticker}/${day}`);
    return respond(ticker, day);
  };
  return { calls, starts, fetcher };
}

const roots: string[] = [];
const day = '2026-10-27';
const previous = '2026-10-26';
const year = '2026';

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
    async list(prefix) {
      events.push(`list ${prefix}`);
      await hooks.before?.('list', prefix);
      return [...objects.keys()].filter((key) => key.startsWith(prefix));
    },
  };
  save('auth/stockbit.json', JSON.stringify({ refresh: 'synthetic-refresh-0' }));
  async function restart() {
    await rm(join(data, 'parquet', 'brokers'), { recursive: true, force: true });
    await rm(join(data, 'parquet', 'broker-coverage.parquet'), { force: true });
    await rm(out, { recursive: true, force: true });
    await rm(token, { force: true });
    for (const [key, bytes] of objects)
      if (key.startsWith('parquet/')) {
        await mkdir(dirname(join(data, key)), { recursive: true });
        await writeFile(join(data, key), bytes);
      }
  }
  async function coverage() {
    return query(
      `SELECT date::VARCHAR date, ticker, complete FROM read_parquet('${join(data, 'parquet', 'broker-coverage.parquet')}') ORDER BY ticker, date DESC`,
    );
  }
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
    restart,
    coverage,
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

const buy = {
  broker: 'AA',
  investor_type: 'Asing',
  shares: 1250,
  value: 625000,
  avg_price: 500,
  freq: 3,
};
const sell = {
  broker: 'BB',
  investor_type: 'Lokal',
  shares: 500,
  value: 255000,
  avg_price: 510,
  freq: 2,
};

describe('private broker pipeline', () => {
  it('finishes each ticker newest first, ranks by total 2026 frequency, and leaves untouched history unpublished', async () => {
    const f = await fixture();
    await prices(f.data, [
      { ticker: 'AAA', date: day, volume: 1 },
      { ticker: 'AAA', date: previous, volume: 1 },
      { ticker: 'BBB', date: day, volume: 1 },
      { ticker: 'BBB', date: '2026-01-01', volume: 1, frequency: 30 },
      { ticker: 'CCC', date: day, volume: 1 },
      { ticker: 'CCC', date: previous, volume: 1 },
      { ticker: 'AAA', date: '2025-12-31', volume: 1, frequency: 10000 },
      { ticker: 'ZERO', date: day, volume: 0 },
      { ticker: 'FUTURE', date: '2026-10-28', volume: 1 },
      { ticker: 'KEPT', date: day, volume: 1 },
    ]);
    const ledger = join(f.data, 'parquet', 'brokers');
    await mkdir(ledger);
    for (const [date, ticker] of [
      ['2024-01-02', 'HISTORY'],
      [day, 'KEPT'],
    ])
      await query(`COPY (SELECT DATE '${date}' date, '${ticker}' ticker, 'buy' side, 'AA' broker,
        'Asing' investor_type, 1250::DOUBLE shares, 625000::DOUBLE AS value, 500::DOUBLE avg_price, 3::DOUBLE freq)
        TO '${join(ledger, date.slice(0, 4) + '.parquet')}' (FORMAT PARQUET)`);
    const history = await readFile(join(ledger, '2024.parquet'));
    f.save(`raw/broker/${day}/CCC.json`, JSON.stringify(summary('CCC', day, true)));
    f.save(`raw/broker/${previous}/CCC.json`, JSON.stringify(summary('CCC', previous)));
    const net = network(f.token, (ticker, date) => Response.json(summary(ticker, date)));
    const options = { ...f.options, fetcher: net.fetcher };
    expect(await brokers(options)).toEqual({
      fetched: 4,
      replayed: 2,
      completed: 6,
      pending: 0,
      failed: [],
    });
    expect(net.calls).toEqual([
      '/login/refresh',
      `BBB/${day}`,
      'BBB/2026-01-01',
      `AAA/${day}`,
      `AAA/${previous}`,
    ]);
    expect(f.events.filter((e) => e.startsWith('list '))).toEqual([
      `list raw/broker/${day}/`,
      'list raw/broker/2026-01-01/',
      `list raw/broker/${previous}/`,
    ]);
    expect(f.events.filter((e) => e.startsWith('get raw/'))).toEqual([
      `get raw/broker/${day}/CCC.json`,
      `get raw/broker/${previous}/CCC.json`,
    ]);
    expect(f.events.filter((e) => e.startsWith('put site/broker/'))).toEqual([
      'put site/broker/BBB.json',
      'put site/broker/AAA.json',
      'put site/broker/CCC.json',
    ]);
    expect(JSON.parse(f.load('site/broker/AAA.json').toString())).toEqual([
      { date: day, buy: [buy], sell: [sell] },
      { date: previous, buy: [buy], sell: [sell] },
    ]);
    expect(JSON.parse(f.load('site/broker/CCC.json').toString())[0]).toEqual({
      date: day,
      buy: [],
      sell: [],
    });
    expect(f.load('parquet/brokers/2024.parquet')).toEqual(history);
    expect(f.objects.has('broker-run.json')).toBe(false);
    expect(f.objects.has('site/market-accumulation.json')).toBe(true);
    await f.restart();
    f.events.length = 0;
    net.calls.length = 0;
    expect(await brokers(options)).toEqual({
      fetched: 0,
      replayed: 0,
      completed: 0,
      pending: 0,
      failed: [],
    });
    expect(net.calls).toEqual([]);
    expect(
      f.events.filter((e) => e.startsWith('list ') || e.startsWith('put site/broker/')),
    ).toEqual([]);
  });

  it('replays an archived empty summary without authenticating or issuing a Stockbit request', async () => {
    const f = await fixture();
    await prices(f.data, [{ ticker: 'AAA', date: day, volume: 1 }]);
    f.objects.delete('auth/stockbit.json');
    const raw = JSON.stringify(summary('AAA', day, true));
    f.save(`raw/broker/${day}/AAA.json`, raw);
    const fetcher = vi.fn<typeof fetch>();
    expect(await brokers({ ...f.options, fetcher })).toEqual({
      fetched: 0,
      replayed: 1,
      completed: 1,
      pending: 0,
      failed: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(f.load(`raw/broker/${day}/AAA.json`).toString()).toBe(raw);
    expect(await f.coverage()).toEqual([{ date: day, ticker: 'AAA', complete: true }]);
    expect(JSON.parse(f.load('site/broker/AAA.json').toString())).toEqual([
      { date: day, buy: [], sell: [] },
    ]);
  });

  it('keeps the completedThrough cutoff at 17:17 Jakarta', async () => {
    const f = await fixture();
    await prices(
      f.data,
      [day, previous].map((date) => ({ ticker: 'AAA', date, volume: 1 })),
    );
    const net = network(f.token, (ticker, date) => Response.json(summary(ticker, date)));
    vi.setSystemTime(new Date(`${day}T10:16:00Z`));
    expect((await brokers({ ...f.options, fetcher: net.fetcher })).completed).toBe(1);
    expect(net.calls).toEqual(['/login/refresh', `AAA/${previous}`]);
    vi.setSystemTime(new Date(`${day}T10:17:00Z`));
    expect((await brokers({ ...f.options, fetcher: net.fetcher })).completed).toBe(1);
    expect(net.calls.slice(2)).toEqual(['/login/refresh', `AAA/${day}`]);
  });

  it('stops new requests at the deadline and checkpoints and publishes the partial ticker', async () => {
    for (const rpm of [30, 20, 15, 12]) {
      const f = await fixture();
      f.save('broker-rpm.json', JSON.stringify(rpm));
      await prices(
        f.data,
        [day, previous, '2026-01-01'].map((date) => ({ ticker: 'AAA', date, volume: 1 })),
      );
      const interval = 60000 / rpm;
      const start = Date.now();
      const net = network(f.token, (ticker, date) => Response.json(summary(ticker, date)));
      const result = await brokers({
        ...f.options,
        deadline: start + 3 * interval,
        fetcher: net.fetcher,
      });
      expect(result).toEqual({ fetched: 1, replayed: 0, completed: 1, pending: 2, failed: [] });
      expect(net.starts).toEqual([start + interval, start + 2 * interval]);
      expect(net.calls).toEqual(['/login/refresh', `AAA/${day}`]);
      expect(await f.coverage()).toEqual([
        { ticker: 'AAA', date: day, complete: true },
        { ticker: 'AAA', date: previous, complete: false },
        { ticker: 'AAA', date: '2026-01-01', complete: false },
      ]);
      expect(f.events.filter((e) => e.startsWith('put site/broker/'))).toEqual([
        'put site/broker/AAA.json',
      ]);
      expect(f.objects.has('site/market-accumulation.json')).toBe(true);
      expect(f.objects.has('broker-run.json')).toBe(false);
    }
  });

  it('continues past 500 requests and 50 minutes while the configured deadline permits work', async () => {
    const f = await fixture();
    const dates = Array.from({ length: 251 }, (_, i) =>
      new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    );
    await prices(
      f.data,
      ['AAA', 'BBB'].flatMap((ticker) => dates.map((date) => ({ ticker, date, volume: 1 }))),
    );
    const net = network(f.token, (ticker, date) => {
      vi.setSystemTime(Date.now() + 7000);
      return Response.json(summary(ticker, date, true));
    });
    const start = Date.now();
    expect((await brokers({ ...f.options, fetcher: net.fetcher })).completed).toBe(502);
    expect(net.starts).toHaveLength(503);
    expect(net.starts[502] - start).toBeGreaterThan(50 * 60000);
  });

  it('overlaps at most eight raw puts with requests and drains before ticker checkpoints or publication', async () => {
    const f = await fixture();
    const dates = Array.from(
      { length: 10 },
      (_, i) => `2026-10-${String(27 - i).padStart(2, '0')}`,
    );
    await prices(f.data, [
      ...dates.map((date) => ({ ticker: 'AAA', date, volume: 1 })),
      { ticker: 'ZZZ', date: day, volume: 1 },
    ]);
    let release: () => void = () => {
      throw new Error('Raw upload not started');
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalLastUpload = () => {};
    const lastUpload = new Promise<void>((resolve) => {
      signalLastUpload = resolve;
    });
    let finishUpload = () => {};
    const finish = new Promise<void>((resolve) => {
      finishUpload = resolve;
    });
    let uploading = 0;
    let peak = 0;
    let started = 0;
    f.hooks.before = async (operation, key) => {
      if (operation !== 'put') return;
      if (key.startsWith('raw/')) {
        uploading++;
        started++;
        peak = Math.max(peak, uploading);
        if (started === 8) release();
        await gate;
        if (key === `raw/broker/${dates[9]}/AAA.json`) {
          signalLastUpload();
          await finish;
        }
      } else if (key.startsWith('parquet/') || key.startsWith('site/')) {
        expect(uploading).toBe(0);
      }
    };
    f.hooks.after = async (operation, key) => {
      if (operation === 'put' && key.startsWith('raw/')) uploading--;
    };
    let requests = 0;
    const net = network(f.token, async (ticker, date) => {
      requests++;
      if (requests === 2) expect(uploading).toBe(1);
      if (ticker === 'ZZZ') {
        expect(f.events).toContain('put parquet/broker-coverage.parquet');
        expect(f.events).toContain('put site/broker/AAA.json');
      }
      vi.setSystemTime(Date.now() + 61000);
      return Response.json(summary(ticker, date));
    });
    const running = brokers({ ...f.options, fetcher: net.fetcher });
    await lastUpload;
    try {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
      expect(
        f.events.filter((e) => e.startsWith('put parquet/') || e.startsWith('put site/')),
      ).toEqual([]);
      expect(f.objects.has('broker-run.json')).toBe(true);
    } finally {
      finishUpload();
    }
    expect((await running).completed).toBe(11);
    expect(peak).toBe(8);
    const checkpoints = f.events.filter((e) => e === 'put parquet/broker-coverage.parquet');
    expect(checkpoints).toHaveLength(2);
    expect(net.starts[2] - net.starts[1]).toBe(61000);
    expect(f.events.filter((e) => e.startsWith('put site/broker/'))).toEqual([
      'put site/broker/AAA.json',
      'put site/broker/ZZZ.json',
    ]);
  });

  it('never checkpoints or publishes a pair whose raw put failed and still deletes its marker', async () => {
    const f = await fixture();
    await prices(
      f.data,
      [day, previous].map((date) => ({ ticker: 'AAA', date, volume: 1 })),
    );
    let release: () => void = () => {
      throw new Error('Raw upload not started');
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.hooks.before = async (operation, key) => {
      if (operation === 'put' && key.startsWith('raw/')) {
        await gate;
        throw new Error('raw upload failed');
      }
    };
    let requests = 0;
    const net = network(f.token, (ticker, date) => {
      if (++requests === 2) release();
      return Response.json(summary(ticker, date));
    });
    await expect(brokers({ ...f.options, fetcher: net.fetcher })).rejects.toThrow(
      'raw upload failed',
    );
    expect(
      f.events.filter((e) => e.startsWith('put parquet/') || e.startsWith('put site/')),
    ).toEqual([]);
    expect(f.objects.has('broker-run.json')).toBe(false);
    expect(JSON.parse(f.load('broker-rpm.json').toString())).toBe(30);
  });

  it('skips invalid pairs, preserves their evidence, finishes later pairs, and reports failure after publication', async () => {
    for (const invalid of [
      'JSON',
      'SUMMARY',
      'DATE',
      'SYMBOL',
      'ROWDATE',
      'ROWSYMBOL',
      'DUPLICATE',
      'BUYCOUNT',
      'SELLCOUNT',
      'NUMBER',
      'FIELD',
    ]) {
      const f = await fixture();
      await prices(
        f.data,
        ['AAA', 'FAIL', 'ZZZ'].map((ticker) => ({ ticker, date: day, volume: 1 })),
      );
      const net = network(f.token, (ticker, date) => {
        const result = summary(ticker, date);
        if (ticker === 'FAIL') {
          if (invalid === 'JSON') return new Response('{');
          if (invalid === 'SUMMARY') return Response.json({ data: {} });
          if (invalid === 'DATE') result.data.to = previous;
          if (invalid === 'SYMBOL') result.data.broker_summary.symbol = 'OTHER';
          if (invalid === 'ROWDATE')
            result.data.broker_summary.brokers_sell[0].netbs_date = '20200101';
          if (invalid === 'ROWSYMBOL')
            result.data.broker_summary.brokers_sell[0].netbs_stock_code = 'OTHER';
          if (invalid === 'DUPLICATE') {
            result.data.broker_summary.brokers_buy.push(result.data.broker_summary.brokers_buy[0]);
            result.data.bandar_detector.total_buyer = 2;
          }
          if (invalid === 'BUYCOUNT') result.data.bandar_detector.total_buyer = 2;
          if (invalid === 'SELLCOUNT') result.data.bandar_detector.total_seller = 2;
          if (invalid === 'NUMBER') result.data.broker_summary.brokers_sell[0].sval = 'NaN';
          if (invalid === 'FIELD') result.data.broker_summary.brokers_sell[0].type = '';
        }
        return Response.json(result);
      });
      const options = { ...f.options, fetcher: net.fetcher };
      await expect(brokers(options)).rejects.toMatchObject({
        summary: {
          fetched: 3,
          replayed: 0,
          completed: 2,
          pending: 1,
          failed: [{ ticker: 'FAIL', date: day, error: expect.any(String) }],
        },
      });
      expect(net.calls).toEqual(['/login/refresh', `AAA/${day}`, `FAIL/${day}`, `ZZZ/${day}`]);
      expect(await f.coverage()).toEqual(
        ['AAA', 'FAIL', 'ZZZ'].map((ticker) => ({
          ticker,
          date: day,
          complete: ticker !== 'FAIL',
        })),
      );
      expect(f.objects.has('site/market-accumulation.json')).toBe(true);
      expect(f.objects.has('broker-run.json')).toBe(false);
      expect(f.events.filter((e) => e.startsWith('put site/broker/'))).toEqual([
        'put site/broker/AAA.json',
        'put site/broker/ZZZ.json',
      ]);
      const bytes = f.load(`raw/broker/${day}/FAIL.json`);
      await f.restart();
      net.calls.length = 0;
      await expect(brokers(options)).rejects.toBeInstanceOf(BrokerRunError);
      expect(net.calls).toEqual([]);
      expect(f.load(`raw/broker/${day}/FAIL.json`)).toEqual(bytes);
      expect(JSON.parse(f.load('broker-rpm.json').toString())).toBe(30);
    }
  });

  it('stops on Stockbit failures, saves completed pairs, and lowers the rate only for HTTP 429', async () => {
    for (const failure of ['401', '429', '503', 'timeout', 'network', 'body']) {
      const f = await fixture();
      await prices(
        f.data,
        [day, previous, '2026-01-01'].map((date) => ({ ticker: 'AAA', date, volume: 1 })),
      );
      const net = network(f.token, (ticker, date) => {
        if (date === previous) {
          if (failure === 'timeout') throw new DOMException('timed out', 'TimeoutError');
          if (failure === 'network') throw new TypeError('network failed');
          if (failure === 'body')
            return new Response(
              new ReadableStream({ pull: (c) => c.error(new TypeError('body failed')) }),
            );
          return new Response('', { status: Number(failure) });
        }
        return Response.json(summary(ticker, date));
      });
      const options = { ...f.options, fetcher: net.fetcher };
      await expect(brokers(options)).rejects.toBeInstanceOf(BrokerRunError);
      expect(net.calls).toEqual(['/login/refresh', `AAA/${day}`, `AAA/${previous}`]);
      expect(JSON.parse(f.load('site/broker/AAA.json').toString())).toEqual([
        { date: day, buy: [buy], sell: [sell] },
      ]);
      expect(f.objects.has('site/market-accumulation.json')).toBe(true);
      expect(f.objects.has('broker-run.json')).toBe(false);
      for (const rpm of failure === '429' ? [20, 15, 12, 12] : [30, 30, 30, 30]) {
        expect(JSON.parse(f.load('broker-rpm.json').toString())).toBe(rpm);
        await f.restart();
        await expect(brokers(options)).rejects.toBeInstanceOf(BrokerRunError);
      }
    }
  });

  it('retains an existing run marker and refuses auth, but clears markers on handled auth or storage errors', async () => {
    for (const cut of [
      'existing-marker',
      'marker-cas',
      'auth-http',
      'auth-invalid',
      'auth-cas',
      'list',
      'year',
      'coverage',
      'site',
    ]) {
      const f = await fixture();
      await prices(f.data, [{ ticker: 'AAA', date: day, volume: 1 }]);
      if (cut === 'existing-marker') f.save('broker-run.json', '{}');
      f.hooks.before = async (operation, key) => {
        if (cut === 'marker-cas' && operation === 'put' && key === 'broker-run.json')
          f.save(key, '{}');
        if (cut === 'auth-cas' && operation === 'put' && key === 'auth/stockbit.json')
          f.save(key, '{"refresh":"other"}');
        if (
          (cut === 'list' && operation === 'list') ||
          (operation === 'put' &&
            key ===
              {
                year: `parquet/brokers/${year}.parquet`,
                coverage: 'parquet/broker-coverage.parquet',
                site: 'site/broker/AAA.json',
              }[cut])
        )
          throw new Error('storage failed');
      };
      const net = network(f.token, (ticker, date) => Response.json(summary(ticker, date)));
      const fetcher: typeof fetch = (input, init) => {
        if (cut === 'auth-http') return Promise.resolve(new Response('', { status: 429 }));
        if (cut === 'auth-invalid') return Promise.resolve(Response.json({ data: {} }));
        return net.fetcher(input, init);
      };
      await expect(brokers({ ...f.options, fetcher })).rejects.toThrow();
      if (cut.startsWith('auth'))
        expect(JSON.parse(f.load('broker-rpm.json').toString())).toBe(
          cut === 'auth-http' ? 20 : 30,
        );
      expect(f.objects.has('broker-run.json')).toBe(
        cut === 'existing-marker' || cut === 'marker-cas',
      );
      if (cut.startsWith('auth') || cut.includes('marker') || cut === 'list')
        expect(net.calls.filter((call) => !call.startsWith('/login'))).toEqual([]);
      if (cut === 'auth-cas')
        expect(f.load('auth/stockbit.json').toString()).toBe('{"refresh":"other"}');
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
          'https://synthetic.r2.cloudflarestorage.com/vibe-idx-private/raw/broker/2026-01-01/AAA.json',
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
        'raw/broker/2026-01-01/AAA.json',
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

  it('lists every page by prefix, preserves ETags and bytes, handles only 404 as missing, and deletes objects', async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      if (!(input instanceof Request)) throw new Error('Expected signed request');
      const url = new URL(input.url);
      calls.push(`${input.method} ${url.pathname}`);
      if (url.searchParams.has('list-type')) {
        expect(url.searchParams.get('list-type')).toBe('2');
        expect(url.searchParams.get('prefix')).toBe('raw/broker/2026-01-01/');
        expect(url.searchParams.get('encoding-type')).toBe('url');
        if (!url.searchParams.has('continuation-token'))
          return new Response(
            '<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>raw%2Fbroker%2F2026-01-01%2FAAA.json</Key></Contents><NextContinuationToken>next&amp;page</NextContinuationToken></ListBucketResult>',
          );
        expect(url.searchParams.get('continuation-token')).toBe('next&page');
        return new Response(
          '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>raw%2Fbroker%2F2026-01-01%2FBBB.json</Key></Contents></ListBucketResult>',
        );
      }
      if (input.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.pathname.endsWith('/missing')) return new Response('', { status: 404 });
      return new Response(Buffer.from([0, 255, 1]), { headers: { ETag: '"bytes"' } });
    };
    const r2 = createR2({ ...credentials, fetcher });
    expect(await r2.list('raw/broker/2026-01-01/')).toEqual([
      'raw/broker/2026-01-01/AAA.json',
      'raw/broker/2026-01-01/BBB.json',
    ]);
    expect(await r2.get('binary')).toEqual({ bytes: Buffer.from([0, 255, 1]), etag: '"bytes"' });
    expect(await r2.get('missing')).toBeUndefined();
    await r2.delete('binary');
    expect(calls).toHaveLength(5);
  });
});
