import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { brokers } from './brokers';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: execute }));
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

async function prices(data: string, rows: { ticker: string; date: string; volume: number }[]) {
  const path = join(data, 'parquet', 'prices');
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
  for (const year of new Set(rows.map((row) => row.date.slice(0, 4)))) {
    const values = rows
      .filter((row) => row.date.startsWith(year))
      .map((row) => `(DATE '${row.date}', '${row.ticker}', ${row.volume})`);
    await query(`COPY (SELECT * FROM (VALUES ${values.join(',')}) p(date, ticker, volume))
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

const day = new Date().toISOString().slice(0, 10);
const previous = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const year = day.slice(0, 4);
const old = '2024-01-02';
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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'brokers-'));
  const remote = join(root, 'remote');
  const data = join(root, 'data');
  const token = join(root, 'stockbit.json');
  const out = join(root, 'private');
  const events: string[] = [];
  const hooks: {
    before?: (operation: string, key: string) => Promise<void>;
    after?: (operation: string, key: string) => Promise<void>;
  } = {};
  async function save(key: string, bytes: string | Buffer) {
    const file = join(remote, key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  async function load(key: string) {
    return readFile(join(remote, key));
  }
  execute.mockImplementation(
    (
      command: string,
      args: string[],
      options: { env: NodeJS.ProcessEnv },
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      void (async () => {
        expect(command).toBe('aws');
        expect(options.env.AWS_MAX_ATTEMPTS).toBe('1');
        expect(args[0]).toBe('s3api');
        expect(args[args.indexOf('--endpoint-url') + 1]).toBe(
          'https://synthetic.r2.cloudflarestorage.com',
        );
        expect(args[args.indexOf('--bucket') + 1]).toBe('vibe-idx-private');
        const operation = args[1];
        const key = args[args.indexOf('--key') + 1];
        events.push(`${operation} ${key}`);
        await hooks.before?.(operation, key);
        const file = join(remote, key);
        const etag = async () =>
          `"${createHash('sha256')
            .update(await load(key))
            .digest('hex')}"`;
        let stdout = '{}';
        if (operation === 'get-object') {
          if (!existsSync(file)) throw new Error('(NoSuchKey)');
          await writeFile(args[args.length - 1], await load(key));
          stdout = JSON.stringify({ ETag: await etag() });
        } else if (operation === 'put-object') {
          if (args.includes('--if-none-match') && existsSync(file))
            throw new Error('(PreconditionFailed)');
          if (
            args.includes('--if-match') &&
            (!existsSync(file) || args[args.indexOf('--if-match') + 1] !== (await etag()))
          )
            throw new Error('(PreconditionFailed)');
          await save(key, await readFile(args[args.indexOf('--body') + 1]));
        } else if (operation === 'delete-object') await rm(file);
        else throw new Error(`Unexpected AWS operation ${operation}`);
        await hooks.after?.(operation, key);
        return stdout;
      })().then(
        (stdout) => callback(null, stdout, ''),
        (error) =>
          callback(error instanceof Error ? error : new Error(String(error)), '', String(error)),
      );
    },
  );
  await save('auth/stockbit.json', JSON.stringify({ refresh: 'synthetic-refresh-0' }));
  async function restart() {
    await rm(join(data, 'parquet', 'brokers'), { recursive: true, force: true });
    await rm(join(data, 'parquet', 'broker-coverage.parquet'), { force: true });
    await rm(join(data, 'raw'), { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
    await rm(token, { force: true });
    for (const key of ['parquet/brokers', 'parquet/broker-coverage.parquet'])
      if (existsSync(join(remote, key)))
        await cp(join(remote, key), join(data, key), { recursive: true });
  }
  return {
    root,
    remote,
    data,
    token,
    out,
    events,
    hooks,
    save,
    load,
    restart,
    options: { data, token, out, accountId: 'synthetic', runKind: 'backfill' as const },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${day}T12:00:00Z`));
  execute.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('private broker pipeline', () => {
  it('backfills and publishes January-onward pairs without dropping history or refetching completed pairs', async () => {
    const f = await fixture();
    const net = network(f.token, (ticker, date) =>
      Response.json(summary(ticker, date, ticker === 'EMPTY')),
    );
    const options = { ...f.options, fetcher: net.fetcher };
    try {
      await mkdir(join(f.root, 'public'));
      const feed = JSON.stringify([{ ticker: 'TEST', date: day, kind: 'ara' }]);
      await writeFile(join(f.root, 'public', 'feed.json'), feed);
      await prices(f.data, [
        { ticker: 'TEST', date: old, volume: 100 },
        { ticker: 'TEST', date: '2025-12-31', volume: 100 },
        { ticker: 'TEST', date: '2026-05-29', volume: 100 },
        ...['TEST', 'EMPTY', 'NORADAR', 'LOCAL', 'KEPT', 'TEST'].map((ticker) => ({
          ticker,
          date: day,
          volume: 100,
        })),
        ...['TEST', 'CACHED', 'EMPTY'].map((ticker) => ({ ticker, date: previous, volume: 100 })),
        { ticker: 'JUNE', date: '2026-06-02', volume: 100 },
        { ticker: 'JANUARY', date: '2026-01-02', volume: 100 },
        { ticker: 'FLOOR', date: '2026-01-01', volume: 100 },
        { ticker: 'ZERO', date: day, volume: 0 },
        {
          ticker: 'FUTURE',
          date: new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10),
          volume: 100,
        },
      ]);
      const ledger = join(f.data, 'parquet', 'brokers');
      await mkdir(ledger);
      for (const [date, ticker] of [
        [old, 'HISTORY'],
        [day, 'KEPT'],
      ])
        await query(`COPY (SELECT DATE '${date}' date, '${ticker}' ticker, 'buy' side, 'AA' broker,
          'Asing' investor_type, 1250::DOUBLE shares, 625000::DOUBLE AS value, 500::DOUBLE avg_price, 3::DOUBLE freq)
          TO '${join(ledger, date.slice(0, 4) + '.parquet')}' (FORMAT PARQUET)`);
      const before = await readFile(join(ledger, '2024.parquet'));
      await query(`COPY (SELECT * FROM (VALUES (DATE '${previous}', 'EMPTY', true), (DATE '2025-12-31', 'OUTSIDE', false), (DATE '2025-12-30', 'OLD-EMPTY', true)) p(date, ticker, complete))
        TO '${join(f.data, 'parquet', 'broker-coverage.parquet')}' (FORMAT PARQUET)`);
      const cached = JSON.stringify(summary('CACHED', previous));
      await f.save(`raw/broker/${previous}/CACHED.json`, cached);
      await f.save(
        'raw/broker/2026-06-02/JUNE.json',
        JSON.stringify(summary('JUNE', '2026-06-02')),
      );
      await f.save(
        'raw/broker/2026-01-01/FLOOR.json',
        JSON.stringify(summary('FLOOR', '2026-01-01', true)),
      );
      const local = join(f.data, 'raw', 'broker', day, 'LOCAL.json');
      await mkdir(dirname(local), { recursive: true });
      await writeFile(local, JSON.stringify(summary('LOCAL', day)));
      vi.setSystemTime(new Date(`${day}T10:16:00Z`));
      expect(await brokers(options)).toEqual({ fetched: 3, replayed: 3, completed: 6, pending: 0 });
      expect(net.calls).toEqual([
        '/login/refresh',
        `TEST/${previous}`,
        'TEST/2026-05-29',
        'JANUARY/2026-01-02',
      ]);
      vi.setSystemTime(new Date(`${day}T10:17:00Z`));
      net.calls.length = 0;
      expect(await brokers(options)).toEqual({ fetched: 3, replayed: 1, completed: 4, pending: 0 });
      expect(net.calls).toEqual([
        '/login/refresh',
        `EMPTY/${day}`,
        `NORADAR/${day}`,
        `TEST/${day}`,
      ]);
      for (const ticker of ['LOCAL', 'NORADAR', 'TEST']) {
        const days = ticker === 'TEST' ? [day, previous, '2026-05-29'] : [day];
        expect(JSON.parse(await readFile(join(f.out, 'broker', ticker + '.json'), 'utf8'))).toEqual(
          days.map((date) => ({ date, buy: [buy], sell: [sell] })),
        );
      }
      const accumulationBytes = await f.load('site/market-accumulation.json');
      expect(accumulationBytes).toEqual(await readFile(join(f.out, 'market-accumulation.json')));
      expect(JSON.parse(accumulationBytes.toString())).toEqual({
        date: new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10),
        stocks: [{ ticker: 'FUTURE', windows: { '1d': null, '3d': null, '5d': null } }],
      });
      expect(JSON.parse((await f.load('site/broker/EMPTY.json')).toString())).toEqual([
        { date: day, buy: [], sell: [] },
        { date: previous, buy: [], sell: [] },
      ]);
      for (const [ticker, date] of [
        ['JUNE', '2026-06-02'],
        ['JANUARY', '2026-01-02'],
      ])
        expect(JSON.parse((await f.load(`site/broker/${ticker}.json`)).toString())).toEqual([
          { date, buy: [buy], sell: [sell] },
        ]);
      expect(JSON.parse((await f.load('site/broker/FLOOR.json')).toString())).toEqual([
        { date: '2026-01-01', buy: [], sell: [] },
      ]);
      expect(await readFile(join(f.root, 'public', 'feed.json'), 'utf8')).toBe(feed);
      expect(await readFile(join(ledger, '2024.parquet'))).toEqual(before);
      expect((await f.load(`raw/broker/${previous}/CACHED.json`)).toString()).toBe(cached);
      expect(
        await query(`SELECT count(*)::INTEGER n FROM read_parquet('${ledger}/*.parquet')`),
      ).toEqual([{ n: 18 }]);
      expect(
        await query(
          `SELECT date::VARCHAR date, ticker, complete FROM read_parquet('${join(f.remote, 'parquet/broker-coverage.parquet')}') WHERE date < DATE '2026-01-01' ORDER BY date`,
        ),
      ).toEqual([
        { date: '2025-12-30', ticker: 'OLD-EMPTY', complete: true },
        { date: '2025-12-31', ticker: 'OUTSIDE', complete: false },
      ]);
      const yearBytes = await f.load(`parquet/brokers/${year}.parquet`);
      await f.restart();
      net.calls.length = 0;
      expect(await brokers(options)).toEqual({ fetched: 0, replayed: 0, completed: 0, pending: 0 });
      expect(net.calls).toEqual([]);
      expect(await f.load(`parquet/brokers/${year}.parquet`)).toEqual(yearBytes);
      expect(await f.load('site/broker/EMPTY.json')).toEqual(
        await readFile(join(f.out, 'broker', 'EMPTY.json')),
      );
      expect(await readdir(join(f.root, 'public'))).toEqual(['feed.json']);
      expect(await brokers({ ...options, runKind: 'daily' })).toEqual({
        fetched: 0,
        replayed: 0,
        completed: 0,
        pending: 0,
      });
      expect(net.calls).toEqual(['/login/refresh']);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('stops at the first provider or transport failure and blocks later auth until operator review', async () => {
    for (const failure of ['401', '429', '503', 'transport', 'json']) {
      const f = await fixture();
      let failing = true;
      const net = network(f.token, async (ticker, date) => {
        if (ticker === 'FAIL') {
          expect(JSON.parse((await f.load(`raw/broker/${day}/AAA.json`)).toString())).toEqual(
            summary('AAA', day, true),
          );
          expect(f.events.lastIndexOf(`get-object raw/broker/${day}/AAA.json`)).toBeGreaterThan(
            f.events.indexOf(`put-object raw/broker/${day}/AAA.json`),
          );
        }
        if (ticker === 'FAIL' && failing) {
          if (failure === 'transport') throw new Error('synthetic transport');
          if (failure === 'json') return new Response('{');
          return new Response('', { status: Number(failure) });
        }
        return Response.json(summary(ticker, date, ticker === 'AAA'));
      });
      const options = { ...f.options, fetcher: net.fetcher };
      try {
        await prices(
          f.data,
          ['AAA', 'FAIL', 'ZZZ'].map((ticker) => ({ ticker, date: day, volume: 1 })),
        );
        await expect(brokers(options)).rejects.toThrow();
        expect(net.calls).toEqual(['/login/refresh', `AAA/${day}`, `FAIL/${day}`]);
        expect(JSON.parse((await f.load('broker-rpm.json')).toString())).toBe(15);
        expect(
          await query(
            `SELECT ticker, complete FROM read_parquet('${join(f.remote, 'parquet/broker-coverage.parquet')}') ORDER BY ticker`,
          ),
        ).toEqual([
          { ticker: 'AAA', complete: true },
          { ticker: 'FAIL', complete: false },
          { ticker: 'ZZZ', complete: false },
        ]);
        expect(JSON.parse((await f.load('site/broker/AAA.json')).toString())).toEqual([
          { date: day, buy: [], sell: [] },
        ]);
        await f.restart();
        net.calls.length = 0;
        await expect(brokers(options)).rejects.toThrow('marker');
        expect(net.calls).toEqual([]);
        await rm(join(f.remote, 'broker-run.json'));
        failing = false;
        if (failure === 'json') {
          await expect(brokers(options)).rejects.toThrow();
          expect(net.calls).toEqual([]);
          expect(JSON.parse((await f.load('broker-rpm.json')).toString())).toBe(12);
        } else {
          const resumed = Date.now();
          const before = net.starts.length;
          expect(await brokers(options)).toEqual({
            fetched: 2,
            replayed: 0,
            completed: 2,
            pending: 0,
          });
          expect(net.calls).toEqual(['/login/refresh', `FAIL/${day}`, `ZZZ/${day}`]);
          expect(net.starts[before] - resumed).toBe(4000);
        }
      } finally {
        await rm(f.root, { recursive: true, force: true });
      }
    }
  });

  it('rejects truncated summaries and wrong identities without saving partial pairs or replacing cached evidence', async () => {
    for (const invalid of [
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
      const net = network(f.token, (ticker, date) => {
        const result = summary(ticker, date);
        if (ticker === 'FAIL') {
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
      try {
        await prices(
          f.data,
          ['AAA', 'FAIL', 'ZZZ'].map((ticker) => ({ ticker, date: day, volume: 1 })),
        );
        await expect(brokers(options)).rejects.toThrow();
        expect(net.calls).toEqual(['/login/refresh', `AAA/${day}`, `FAIL/${day}`]);
        expect(
          await query(`SELECT ticker, side, broker, investor_type, shares, value, avg_price, freq
          FROM read_parquet('${join(f.remote, `parquet/brokers/${year}.parquet`)}') ORDER BY side`),
        ).toEqual([
          { ticker: 'AAA', side: 'buy', ...buy },
          { ticker: 'AAA', side: 'sell', ...sell },
        ]);
        expect(
          await query(
            `SELECT ticker FROM read_parquet('${join(f.remote, 'parquet/broker-coverage.parquet')}') WHERE NOT complete ORDER BY ticker`,
          ),
        ).toEqual([{ ticker: 'FAIL' }, { ticker: 'ZZZ' }]);
        const bytes = await f.load(`raw/broker/${day}/FAIL.json`);
        await f.restart();
        await rm(join(f.remote, 'broker-run.json'));
        net.calls.length = 0;
        await expect(brokers(options)).rejects.toThrow();
        expect(net.calls).toEqual([]);
        expect(await f.load(`raw/broker/${day}/FAIL.json`)).toEqual(bytes);
      } finally {
        await rm(f.root, { recursive: true, force: true });
      }
    }
  });

  it('recovers publication failures on reused and fresh runners without losing rows or refetching pairs', async () => {
    for (const cut of [
      'raw-write',
      'raw-cas',
      'raw-readback',
      'year',
      'year-fresh',
      'coverage',
      'empty-coverage',
      'json',
    ]) {
      const f = await fixture();
      const rawKey = `raw/broker/${day}/AAA.json`;
      let savedRaw = false;
      f.hooks.before = async (operation, key) => {
        if (cut === 'raw-cas' && operation === 'put-object' && key === rawKey)
          await f.save(key, JSON.stringify(summary('AAA', day)));
        if (
          (cut === 'raw-write' && operation === 'put-object' && key === rawKey) ||
          (cut === 'raw-readback' && operation === 'get-object' && key === rawKey && savedRaw) ||
          (operation === 'put-object' &&
            key ===
              {
                year: `parquet/brokers/${year}.parquet`,
                'year-fresh': `parquet/brokers/${year}.parquet`,
                coverage: 'parquet/broker-coverage.parquet',
                'empty-coverage': 'parquet/broker-coverage.parquet',
                json: 'site/broker/AAA.json',
              }[cut])
        )
          throw new Error('synthetic storage failure');
      };
      f.hooks.after = async (operation, key) => {
        if (operation === 'put-object' && key === rawKey) savedRaw = true;
      };
      const net = network(f.token, (ticker, date) =>
        Response.json(summary(ticker, date, cut === 'empty-coverage')),
      );
      const options = { ...f.options, fetcher: net.fetcher };
      try {
        await prices(f.data, [{ ticker: 'AAA', date: day, volume: 1 }]);
        const ledger = join(f.data, 'parquet', 'brokers', `${year}.parquet`);
        await mkdir(dirname(ledger), { recursive: true });
        await query(`COPY (SELECT DATE '${day}' date, 'HISTORY' ticker, 'buy' side, 'AA' broker,
          'Asing' investor_type, 1250::DOUBLE shares, 625000::DOUBLE AS value, 500::DOUBLE avg_price, 3::DOUBLE freq)
          TO '${ledger}' (FORMAT PARQUET)`);
        await f.save(`parquet/brokers/${year}.parquet`, await readFile(ledger));
        await expect(brokers(options)).rejects.toThrow(
          cut === 'raw-cas' ? 'PreconditionFailed' : 'synthetic storage failure',
        );
        expect(JSON.parse((await f.load('broker-rpm.json')).toString())).toBe(15);
        expect(net.calls).toEqual(['/login/refresh', `AAA/${day}`]);
        expect(JSON.parse((await f.load('auth/stockbit.json')).toString()).refresh).toBe(
          'synthetic-refresh-1',
        );
        if (cut.startsWith('year'))
          expect(existsSync(join(f.remote, 'parquet/broker-coverage.parquet'))).toBe(false);
        if (cut === 'coverage')
          expect(existsSync(join(f.remote, `parquet/brokers/${year}.parquet`))).toBe(true);
        if (cut === 'raw-write' || cut === 'raw-readback')
          expect(
            await query(
              `SELECT complete FROM read_parquet('${join(f.remote, 'parquet/broker-coverage.parquet')}')`,
            ),
          ).toEqual([{ complete: false }]);
        expect(existsSync(join(f.remote, 'broker-run.json'))).toBe(true);
        net.calls.length = 0;
        await expect(brokers(options)).rejects.toThrow('marker');
        expect(net.calls).toEqual([]);
        if (cut !== 'raw-write' && cut !== 'year') await f.restart();
        f.hooks.before = undefined;
        await rm(join(f.remote, 'broker-run.json'));
        const progress = await brokers(options);
        expect(progress.fetched).toBe(0);
        expect(progress.pending).toBe(0);
        expect(net.calls).toEqual([]);
        const rows = await query(`SELECT date::VARCHAR date, ticker, side, broker, investor_type,
          shares, value, avg_price, freq FROM read_parquet('${join(f.remote, `parquet/brokers/${year}.parquet`)}') ORDER BY ticker, side`);
        expect(rows).toEqual([
          ...(cut === 'empty-coverage'
            ? []
            : [
                { date: day, ticker: 'AAA', side: 'buy', ...buy },
                { date: day, ticker: 'AAA', side: 'sell', ...sell },
              ]),
          { date: day, ticker: 'HISTORY', side: 'buy', ...buy },
        ]);
        await f.restart();
        expect(await brokers(options)).toEqual({
          fetched: 0,
          replayed: 0,
          completed: 0,
          pending: 0,
        });
        expect(net.calls).toEqual([]);
        expect(
          await query(`SELECT date::VARCHAR date, ticker, side, broker, investor_type,
          shares, value, avg_price, freq FROM read_parquet('${ledger}') ORDER BY ticker, side`),
        ).toEqual(rows);
        expect(JSON.parse((await f.load('site/broker/AAA.json')).toString())).toEqual([
          {
            date: day,
            buy: cut === 'empty-coverage' ? [] : [buy],
            sell: cut === 'empty-coverage' ? [] : [sell],
          },
        ]);
        expect(
          await query(
            `SELECT complete FROM read_parquet('${join(f.remote, 'parquet/broker-coverage.parquet')}')`,
          ),
        ).toEqual([{ complete: true }]);
      } finally {
        await rm(f.root, { recursive: true, force: true });
      }
    }
  });

  it('blocks data on auth checkpoint failure and treats only NoSuchKey as a raw cache miss', async () => {
    for (const cut of [
      'auth-http',
      'auth-invalid',
      'token-write',
      'token-cas',
      'token-readback',
      'denied',
      'bucket',
      'network',
      'marker-cas',
      'marker-denied',
    ]) {
      const f = await fixture();
      let tokenSaved = false;
      f.hooks.before = async (operation, key) => {
        if (
          operation === 'get-object' &&
          key.startsWith('raw/') &&
          ['denied', 'bucket', 'network'].includes(cut)
        )
          throw new Error(
            {
              denied: '(AccessDenied)',
              bucket: '(NoSuchBucket)',
              network: 'transport unavailable',
            }[cut],
          );
        if (cut === 'token-write' && operation === 'put-object' && key === 'auth/stockbit.json')
          throw new Error('token write failure');
        if (cut === 'token-cas' && operation === 'put-object' && key === 'auth/stockbit.json')
          await f.save(key, JSON.stringify({ refresh: 'other-writer' }));
        if (cut === 'marker-cas' && operation === 'put-object' && key === 'broker-run.json')
          await f.save(key, '{}');
        if (cut === 'marker-denied' && operation === 'get-object' && key === 'broker-run.json')
          throw new Error('(AccessDenied)');
        if (
          cut === 'token-readback' &&
          tokenSaved &&
          operation === 'get-object' &&
          key === 'auth/stockbit.json'
        )
          await f.save(key, '{}');
      };
      f.hooks.after = async (operation, key) => {
        if (operation === 'put-object' && key === 'auth/stockbit.json') tokenSaved = true;
      };
      const normal = network(f.token, (ticker, date) => Response.json(summary(ticker, date)));
      const fetcher: typeof fetch = async (input, init) => {
        if (cut === 'auth-http') return new Response('', { status: 429 });
        if (cut === 'auth-invalid') return Response.json({ data: {} });
        return normal.fetcher(input, init);
      };
      try {
        await prices(f.data, [{ ticker: 'AAA', date: day, volume: 1 }]);
        const options = { ...f.options, runKind: 'daily' as const, fetcher };
        await expect(brokers(options)).rejects.toThrow();
        expect(normal.calls.filter((call) => !call.startsWith('/login'))).toEqual([]);
        if (cut.startsWith('marker')) expect(normal.calls).toEqual([]);
        else expect(existsSync(join(f.remote, 'broker-run.json'))).toBe(true);
        if (cut === 'token-cas')
          expect(JSON.parse((await f.load('auth/stockbit.json')).toString()).refresh).toBe(
            'other-writer',
          );
      } finally {
        await rm(f.root, { recursive: true, force: true });
      }
    }
  });

  it('paces 20, 15 and 12 RPM across runs without bursts and yields at the attempt and time budgets', async () => {
    for (const [rpm, limit] of [
      [20, 'attempts'],
      [15, 'time'],
      [12, 'time'],
    ] as const) {
      const f = await fixture();
      await f.save('broker-rpm.json', JSON.stringify(rpm));
      let count = 0;
      const net = network(f.token, async (ticker, date) => {
        count++;
        if (limit === 'time') vi.setSystemTime(Date.now() + (count === 1 ? 20000 : 50 * 60000));
        return Response.json(summary(ticker, date, true));
      });
      try {
        await prices(
          f.data,
          Array.from({ length: limit === 'attempts' ? 501 : 3 }, (_, i) => ({
            ticker: `T${String(i).padStart(3, '0')}`,
            date: day,
            volume: 1,
          })),
        );
        const start = Date.now();
        const options = { ...f.options, fetcher: net.fetcher };
        const result = await brokers(options);
        expect(result.fetched).toBe(limit === 'attempts' ? 499 : 2);
        expect(result.pending).toBe(limit === 'attempts' ? 2 : 1);
        expect(net.starts[0] - start).toBe(60000 / rpm);
        expect(net.starts.length).toBeLessThanOrEqual(500);
        expect(net.starts.every((time) => time - start < 50 * 60000)).toBe(true);
        for (let i = 1; i < net.starts.length; i++)
          expect(net.starts[i] - net.starts[i - 1]).toBeGreaterThanOrEqual(60000 / rpm);
        expect(existsSync(join(f.remote, 'broker-run.json'))).toBe(false);
        if (limit === 'time') expect(net.starts[2] - net.starts[1]).toBe(20000);
        const lastStart = net.starts[net.starts.length - 1];
        if (limit === 'attempts') vi.setSystemTime(lastStart);
        const invoked = Date.now();
        const before = net.starts.length;
        await f.restart();
        await brokers(options);
        expect(net.starts[before] - invoked).toBe(60000 / rpm);
      } finally {
        await rm(f.root, { recursive: true, force: true });
      }
    }
  }, 30000);

  it('checkpoints cached imports before the next provider request can interrupt the runner', async () => {
    const f = await fixture();
    const targets = Array.from({ length: 26 }, (_, i) => `T${String(i).padStart(3, '0')}`);
    try {
      await prices(
        f.data,
        targets.map((ticker) => ({ ticker, date: day, volume: 1 })),
      );
      for (const ticker of targets.slice(0, 25))
        await f.save(`raw/broker/${day}/${ticker}.json`, JSON.stringify(summary(ticker, day)));
      const net = network(f.token, () => {
        throw new Error('synthetic interruption');
      });
      const fetcher: typeof fetch = async (input, init) => {
        expect(
          await query(
            `SELECT count(*)::INTEGER n FROM read_parquet('${join(f.remote, `parquet/brokers/${year}.parquet`)}')`,
          ),
        ).toEqual([{ n: 50 }]);
        expect(
          await query(
            `SELECT count(*)::INTEGER n FROM read_parquet('${join(f.remote, 'parquet/broker-coverage.parquet')}') WHERE complete`,
          ),
        ).toEqual([{ n: 25 }]);
        return net.fetcher(input, init);
      };
      await expect(brokers({ ...f.options, fetcher })).rejects.toThrow('synthetic interruption');
      expect(net.calls).toEqual(['/login/refresh', `T025/${day}`]);
      const yearUpload = f.events.indexOf(`put-object parquet/brokers/${year}.parquet`);
      expect(f.events.indexOf('put-object parquet/broker-coverage.parquet')).toBeGreaterThan(
        yearUpload,
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});
