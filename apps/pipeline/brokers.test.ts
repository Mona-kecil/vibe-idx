import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
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

const boards: Record<string, string> = {
  MARKET_BOARD_REGULER: 'regular',
  MARKET_BOARD_NEGO: 'negotiation',
  MARKET_BOARD_TUNAI: 'cash',
};

function network(
  token: string,
  respond: (ticker: string, day: string, board: string) => Response | Promise<Response>,
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
    const board = boards[url.searchParams.get('market_board') ?? ''];
    if (!board) throw new Error('Unexpected broker board');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: day,
      to: day,
      transaction_type: 'TRANSACTION_TYPE_GROSS',
      market_board: url.searchParams.get('market_board'),
      investor_type: 'INVESTOR_TYPE_ALL',
      limit: '200',
    });
    calls.push(`${ticker}/${day}/${board}`);
    return respond(ticker, day, board);
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
      `SELECT date::VARCHAR date, ticker, board, complete FROM read_parquet('${join(data, 'parquet', 'broker-coverage.parquet')}') ORDER BY ticker, date DESC, board`,
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
  it('fetches every board once authenticated and publishes only the boards that traded', async () => {
    const f = await fixture();
    await prices(f.data, [
      { ticker: 'AAA', date: day, volume: 1 },
      { ticker: 'AAA', date: previous, volume: 1 },
      { ticker: 'BBB', date: day, volume: 1 },
      { ticker: 'AAA', date: '2025-12-31', volume: 1, frequency: 10000 },
      { ticker: 'ZERO', date: day, volume: 0 },
      { ticker: 'FUTURE', date: '2026-10-28', volume: 1 },
    ]);
    const ledger = join(f.data, 'parquet', 'brokers');
    await mkdir(ledger);
    await query(`COPY (SELECT DATE '2024-01-02' date, 'HISTORY' ticker, 'regular' board, 'buy' side,
      'AA' broker, 'Asing' investor_type, 1250::DOUBLE shares, 625000::DOUBLE AS value,
      500::DOUBLE avg_price, 3::DOUBLE freq)
      TO '${join(ledger, '2024.parquet')}' (FORMAT PARQUET)`);
    const history = await readFile(join(ledger, '2024.parquet'));
    const net = network(f.token, (ticker, date, board) =>
      Response.json(
        summary(
          ticker,
          date,
          !(board === 'regular' || (ticker === 'AAA' && date === day && board === 'negotiation')),
        ),
      ),
    );
    const options = { ...f.options, fetcher: net.fetcher };
    expect(await brokers(options)).toEqual({ fetched: 9, completed: 9, pending: 0, failed: [] });
    expect(net.calls.filter((call) => call === '/login/refresh')).toHaveLength(1);
    expect(net.calls.slice(1).sort()).toEqual(
      [...['AAA', 'BBB'].map((ticker) => [ticker, day] as const), ['AAA', previous] as const]
        .flatMap(([ticker, date]) =>
          ['cash', 'negotiation', 'regular'].map((board) => `${ticker}/${date}/${board}`),
        )
        .sort(),
    );
    expect(JSON.parse(gunzipSync(f.load('site/broker/AAA.json.gz')).toString())).toEqual([
      { date: day, board: 'negotiation', buy: [buy], sell: [sell] },
      { date: day, board: 'regular', buy: [buy], sell: [sell] },
      { date: previous, board: 'regular', buy: [buy], sell: [sell] },
    ]);
    expect(f.load('parquet/brokers/2024.parquet')).toEqual(history);
    expect(f.objects.has('broker-run.json')).toBe(false);
    expect(f.objects.has('site/market-accumulation.json')).toBe(true);
    expect([...f.objects.keys()].filter((key) => key.startsWith('raw/'))).toEqual([]);
    await f.restart();
    f.events.length = 0;
    net.calls.length = 0;
    expect(await brokers(options)).toEqual({ fetched: 0, completed: 0, pending: 0, failed: [] });
    expect(net.calls).toEqual([]);
    expect(f.events.filter((e) => e.startsWith('put site/broker/'))).toEqual([]);
  });

  it('walks each ticker newest first and leaves the quietest ticker for a free worker', async () => {
    const f = await fixture();
    const tickers = Array.from({ length: 48 }, (_, i) => `T${String(i).padStart(2, '0')}`);
    await prices(f.data, [
      ...tickers.map((ticker, i) => ({ ticker, date: day, volume: 1, frequency: 1000 - i })),
      { ticker: 'T00', date: previous, volume: 1 },
    ]);
    const net = network(f.token, (ticker, date) => Response.json(summary(ticker, date, true)));
    await brokers({ ...f.options, fetcher: net.fetcher });
    expect(net.calls.filter((call) => call.startsWith('T00'))).toEqual(
      [day, previous].flatMap((date) =>
        ['cash', 'negotiation', 'regular'].map((board) => `T00/${date}/${board}`),
      ),
    );
    const firstCalls = net.calls.filter((call) => call.endsWith(`${day}/cash`));
    expect(firstCalls.at(-1)).toBe(`T47/${day}/cash`);
  });

  it('uploads changed tickers at once', async () => {
    const f = await fixture();
    const tickers = ['AAA', 'BBB', 'CCC'];
    await prices(
      f.data,
      tickers.map((ticker) => ({ ticker, date: day, volume: 1 })),
    );
    let release = () => {};
    const allStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    f.hooks.before = async (operation, key) => {
      if (operation !== 'put' || !key.startsWith('site/broker/')) return;
      if (++started === tickers.length) release();
      await allStarted;
    };
    const net = network(f.token, (ticker, date) => Response.json(summary(ticker, date, true)));
    await brokers({ ...f.options, fetcher: net.fetcher });
    expect(tickers.filter((ticker) => f.objects.has(`site/broker/${ticker}.json.gz`))).toEqual(
      tickers,
    );
  });

  it('holds each ticker to eight requests a second', async () => {
    const f = await fixture();
    await prices(
      f.data,
      [day, previous].map((date) => ({ ticker: 'AAA', date, volume: 1 })),
    );
    const net = network(f.token, (ticker, date) => Response.json(summary(ticker, date, true)));
    await brokers({ ...f.options, fetcher: net.fetcher });
    const gaps = net.starts.slice(2).map((start, i) => start - net.starts[i + 1]);
    expect(gaps).toEqual(Array(5).fill(125));
  });

  it('runs at most 47 tickers at once, keeping total requests under 380 a second', async () => {
    const f = await fixture();
    const tickers = Array.from({ length: 60 }, (_, i) => `T${String(i).padStart(2, '0')}`);
    await prices(
      f.data,
      tickers.map((ticker) => ({ ticker, date: day, volume: 1 })),
    );
    let active = 0;
    let peak = 0;
    const net = network(f.token, async (ticker, date) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return Response.json(summary(ticker, date, true));
    });
    await brokers({ ...f.options, fetcher: net.fetcher });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(47);
  });

  it('keeps the completedThrough cutoff at 17:17 Jakarta', async () => {
    const f = await fixture();
    await prices(
      f.data,
      [day, previous].map((date) => ({ ticker: 'AAA', date, volume: 1 })),
    );
    const net = network(f.token, (ticker, date) => Response.json(summary(ticker, date)));
    vi.setSystemTime(new Date(`${day}T10:16:00Z`));
    expect((await brokers({ ...f.options, fetcher: net.fetcher })).completed).toBe(3);
    expect(net.calls[1]).toBe(`AAA/${previous}/cash`);
    expect(net.calls).toHaveLength(4);
    vi.setSystemTime(new Date(`${day}T10:17:00Z`));
    net.calls.length = 0;
    expect((await brokers({ ...f.options, fetcher: net.fetcher })).completed).toBe(3);
    expect(net.calls[1]).toBe(`AAA/${day}/cash`);
    expect(net.calls).toHaveLength(4);
  });

  it('stops new requests at the deadline and checkpoints and publishes the partial ticker', async () => {
    const f = await fixture();
    await prices(
      f.data,
      [day, previous, '2026-01-01'].map((date) => ({ ticker: 'AAA', date, volume: 1 })),
    );
    const net = network(f.token, (ticker, date, board) =>
      Response.json(summary(ticker, date, board !== 'cash')),
    );
    const result = await brokers({
      ...f.options,
      deadline: Date.now() + 200,
      fetcher: net.fetcher,
    });
    expect(result).toEqual({ fetched: 2, completed: 2, pending: 7, failed: [] });
    expect(net.calls).toEqual(['/login/refresh', `AAA/${day}/cash`, `AAA/${day}/negotiation`]);
    expect((await f.coverage()).filter((row) => row.complete)).toEqual([
      { ticker: 'AAA', date: day, board: 'cash', complete: true },
      { ticker: 'AAA', date: day, board: 'negotiation', complete: true },
    ]);
    expect(f.events.filter((e) => e.startsWith('put site/broker/'))).toEqual([
      'put site/broker/AAA.json.gz',
    ]);
    expect(f.objects.has('site/market-accumulation.json')).toBe(true);
    expect(f.objects.has('broker-run.json')).toBe(false);
  });

  it('retries dropped data connections so the pair is saved', async () => {
    for (const failures of [1, 2]) {
      const f = await fixture();
      await prices(f.data, [{ ticker: 'AAA', date: day, volume: 1 }]);
      let attempts = 0;
      const net = network(f.token, (ticker, date, board) => {
        if (board === 'cash' && ++attempts <= failures) throw new TypeError('fetch failed');
        return Response.json(summary(ticker, date, board !== 'regular'));
      });
      const start = Date.now();
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await brokers({ ...f.options, fetcher: net.fetcher });
      log.mockRestore();
      expect(result).toEqual({ fetched: 3, completed: 3, pending: 0, failed: [] });
      expect(net.calls.filter((call) => call === `AAA/${day}/cash`)).toHaveLength(failures + 1);
      expect(net.starts.slice(1, failures + 2)).toEqual(
        [0, 1000, 3000].slice(0, failures + 1).map((ms) => start + ms),
      );
      expect((await f.coverage()).every((row) => row.complete)).toBe(true);
    }
  });

  it('stops retries at the deadline during backoff and saves completed pairs', async () => {
    const f = await fixture();
    await prices(
      f.data,
      [day, previous].map((date) => ({ ticker: 'AAA', date, volume: 1 })),
    );
    const net = network(f.token, (ticker, date, board) => {
      if (date === previous && board === 'regular') throw new TypeError('fetch failed');
      return Response.json(summary(ticker, date));
    });
    const deadline = Date.now() + 2000;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await brokers({ ...f.options, deadline, fetcher: net.fetcher })).toEqual({
      fetched: 5,
      completed: 5,
      pending: 1,
      failed: [],
    });
    log.mockRestore();
    expect(Date.now()).toBe(deadline);
    expect(await f.coverage()).toEqual([
      { ticker: 'AAA', date: day, board: 'cash', complete: true },
      { ticker: 'AAA', date: day, board: 'negotiation', complete: true },
      { ticker: 'AAA', date: day, board: 'regular', complete: true },
      { ticker: 'AAA', date: previous, board: 'cash', complete: true },
      { ticker: 'AAA', date: previous, board: 'negotiation', complete: true },
      { ticker: 'AAA', date: previous, board: 'regular', complete: false },
    ]);
    expect(f.objects.has('site/broker/AAA.json.gz')).toBe(true);
    expect(f.objects.has('broker-run.json')).toBe(false);
  });

  it('skips invalid pairs, finishes later pairs, and reports failure after publication', async () => {
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
      const net = network(f.token, (ticker, date, board) => {
        const result = summary(ticker, date);
        if (ticker === 'FAIL' && board === 'regular') {
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
          fetched: 9,
          completed: 8,
          pending: 1,
          failed: [{ ticker: 'FAIL', date: day, board: 'regular', error: expect.any(String) }],
        },
      });
      expect((await f.coverage()).filter((row) => !row.complete)).toEqual([
        { ticker: 'FAIL', date: day, board: 'regular', complete: false },
      ]);
      expect(f.objects.has('site/market-accumulation.json')).toBe(true);
      expect(f.objects.has('broker-run.json')).toBe(false);
      await f.restart();
      net.calls.length = 0;
      await expect(brokers(options)).rejects.toBeInstanceOf(BrokerRunError);
      expect(net.calls).toEqual(['/login/refresh', `FAIL/${day}/regular`]);
    }
  });

  it('stops on Stockbit failures after retrying only transient ones, and saves completed pairs', async () => {
    for (const failure of [
      '401',
      '403',
      '429',
      '500',
      '502',
      '503',
      '504',
      'timeout',
      'network',
      'body',
    ]) {
      const f = await fixture();
      await prices(
        f.data,
        [day, previous, '2026-01-01'].map((date) => ({ ticker: 'AAA', date, volume: 1 })),
      );
      const net = network(f.token, (ticker, date, board) => {
        if (date === previous && board === 'cash') {
          if (failure === 'timeout') throw new DOMException('timed out', 'TimeoutError');
          if (failure === 'network') throw new TypeError('network failed');
          if (failure === 'body')
            return new Response(
              new ReadableStream({ pull: (c) => c.error(new TypeError('body failed')) }),
            );
          return new Response('', { status: Number(failure) });
        }
        return Response.json(summary(ticker, date, board !== 'regular'));
      });
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(brokers({ ...f.options, fetcher: net.fetcher })).rejects.toBeInstanceOf(
        BrokerRunError,
      );
      const attempts = ['401', '403', '429'].includes(failure) ? 1 : 4;
      expect(net.calls).toEqual([
        '/login/refresh',
        ...['cash', 'negotiation', 'regular'].map((board) => `AAA/${day}/${board}`),
        ...Array(attempts).fill(`AAA/${previous}/cash`),
      ]);
      const retries = log.mock.calls
        .map(([line]) => JSON.parse(line))
        .filter((line) => line.attempt !== undefined);
      expect(retries).toHaveLength(attempts - 1);
      log.mockRestore();
      expect(JSON.parse(gunzipSync(f.load('site/broker/AAA.json.gz')).toString())).toEqual([
        { date: day, board: 'regular', buy: [buy], sell: [sell] },
      ]);
      expect(f.objects.has('site/market-accumulation.json')).toBe(true);
      expect(f.objects.has('broker-run.json')).toBe(false);
    }
  }, 30000);

  it('stops every ticker on the first failure', async () => {
    const f = await fixture();
    const tickers = Array.from({ length: 60 }, (_, i) => `T${String(i).padStart(2, '0')}`);
    await prices(
      f.data,
      tickers.map((ticker) => ({ ticker, date: day, volume: 1 })),
    );
    const net = network(f.token, async (ticker, date) => {
      if (ticker === 'T00') return new Response('', { status: 429 });
      await new Promise((resolve) => setImmediate(resolve));
      return Response.json(summary(ticker, date, true));
    });
    await expect(brokers({ ...f.options, fetcher: net.fetcher })).rejects.toBeInstanceOf(
      BrokerRunError,
    );
    expect(net.calls.some((call) => call.startsWith('T59/'))).toBe(false);
    expect(net.calls.filter((call) => call.startsWith('T01/'))).toHaveLength(1);
  });

  it('retains an existing run marker and refuses auth, but clears markers on handled auth or storage errors', async () => {
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
          operation === 'put' &&
          key ===
            {
              year: `parquet/brokers/${year}.parquet`,
              coverage: 'parquet/broker-coverage.parquet',
              site: 'site/broker/AAA.json.gz',
            }[cut]
        )
          throw new Error('storage failed');
      };
      const net = network(f.token, (ticker, date) => Response.json(summary(ticker, date)));
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
