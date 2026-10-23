import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vite-plus/test';
import { brokers } from './brokers';

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

function network(token: string, respond: (ticker: string, day: string) => Response) {
  const calls: string[] = [];
  let refreshes = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
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
  return { calls, fetcher };
}

const day = new Date().toISOString().slice(0, 10);
const previous = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const old = `${Number(day.slice(0, 4)) - 2}-01-02`;
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
  it('covers traded stocks outside radar from the latest day and never refetches completed empty pairs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brokers-replay-'));
    const data = join(root, 'data');
    const out = join(root, 'private');
    const token = join(root, 'stockbit.json');
    const net = network(token, (ticker, date) =>
      Response.json(summary(ticker, date, ticker === 'EMPTY')),
    );
    const options = { data, token, out, fetcher: net.fetcher };
    const targets = [
      { ticker: 'TEST', date: old, volume: 100 },
      { ticker: 'TEST', date: previous, volume: 100 },
      { ticker: 'TEST', date: day, volume: 100 },
      { ticker: 'TEST', date: day, volume: 100 },
      { ticker: 'NORADAR', date: day, volume: 100 },
      { ticker: 'EMPTY', date: day, volume: 100 },
      { ticker: 'ZERO', date: day, volume: 0 },
    ];
    try {
      await writeFile(token, JSON.stringify({ refresh: 'synthetic-refresh-0' }));
      await mkdir(join(root, 'public'));
      const feed = JSON.stringify([{ ticker: 'TEST', date: day, kind: 'ara' }]);
      await writeFile(join(root, 'public', 'feed.json'), feed);
      await prices(data, targets);
      expect(await brokers(options)).toEqual({ fetched: 3 });
      expect(net.calls).toEqual([
        '/login/refresh',
        `EMPTY/${day}`,
        `NORADAR/${day}`,
        `TEST/${day}`,
      ]);
      expect(
        JSON.parse(await readFile(join(data, 'raw', 'broker', day, 'NORADAR.json'), 'utf8')),
      ).toEqual(summary('NORADAR', day));
      for (const ticker of ['TEST', 'NORADAR'])
        expect(JSON.parse(await readFile(join(out, 'broker', `${ticker}.json`), 'utf8'))).toEqual([
          { date: day, buy: [buy], sell: [sell] },
        ]);
      expect(JSON.parse(await readFile(join(out, 'broker', 'EMPTY.json'), 'utf8'))).toEqual([
        { date: day, buy: [], sell: [] },
      ]);
      expect(await readdir(join(out, 'broker'))).toEqual([
        'EMPTY.json',
        'NORADAR.json',
        'TEST.json',
      ]);
      expect(await readFile(join(root, 'public', 'feed.json'), 'utf8')).toBe(feed);
      const ledger = join(data, 'parquet', 'brokers', `${day.slice(0, 4)}.parquet`);
      expect(await query(`SELECT count(*)::INTEGER n FROM read_parquet('${ledger}')`)).toEqual([
        { n: 4 },
      ]);
      const before = { bytes: await readFile(ledger), mtime: (await stat(ledger)).mtimeMs };
      await rm(join(data, 'raw'), { recursive: true });
      await rm(out, { recursive: true });
      net.calls.length = 0;
      expect(await brokers(options)).toEqual({ fetched: 0 });
      expect(net.calls).toEqual(['/login/refresh']);
      expect({ bytes: await readFile(ledger), mtime: (await stat(ledger)).mtimeMs }).toEqual(
        before,
      );
      expect(JSON.parse(await readFile(join(out, 'broker', 'EMPTY.json'), 'utf8'))).toEqual([
        { date: day, buy: [], sell: [] },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains a truncated pending pair after later dates succeed and saves catch-up history before failing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brokers-retry-'));
    const data = join(root, 'data');
    const token = join(root, 'stockbit.json');
    const out = join(root, 'private');
    let truncated = true;
    const net = network(token, (ticker, date) => {
      const result = summary(ticker, date);
      if (ticker === 'RETRY' && truncated) result.data.bandar_detector.total_buyer = 2;
      return Response.json(result);
    });
    const options = { data, token, out, fetcher: net.fetcher };
    const coverage = join(data, 'parquet', 'broker-coverage.parquet');
    try {
      await writeFile(token, JSON.stringify({ refresh: 'synthetic-refresh-0' }));
      await prices(data, [
        { ticker: 'GOOD', date: old, volume: 100 },
        { ticker: 'RETRY', date: old, volume: 100 },
      ]);
      await expect(brokers(options)).rejects.toThrow(`Incomplete broker summary: RETRY/${old}`);
      const archived = join(data, 'parquet', 'brokers', `${old.slice(0, 4)}.parquet`);
      const before = await readFile(archived);
      await prices(data, [
        { ticker: 'GOOD', date: previous, volume: 100 },
        { ticker: 'GOOD', date: day, volume: 100 },
        { ticker: 'ZERO', date: previous, volume: 0 },
      ]);
      net.calls.length = 0;
      await expect(brokers(options)).rejects.toThrow(`Incomplete broker summary: RETRY/${old}`);
      expect(net.calls).toEqual([
        '/login/refresh',
        `RETRY/${old}`,
        `GOOD/${previous}`,
        `GOOD/${day}`,
      ]);
      expect(await readFile(archived)).toEqual(before);
      expect(
        await query(`SELECT date::VARCHAR date, ticker, complete FROM read_parquet('${coverage}')
          ORDER BY date, ticker`),
      ).toEqual([
        { date: old, ticker: 'GOOD', complete: true },
        { date: old, ticker: 'RETRY', complete: false },
        { date: previous, ticker: 'GOOD', complete: true },
        { date: day, ticker: 'GOOD', complete: true },
      ]);
      expect(JSON.parse(await readFile(join(out, 'broker', 'GOOD.json'), 'utf8'))).toEqual([
        { date: day, buy: [buy], sell: [sell] },
        { date: previous, buy: [buy], sell: [sell] },
      ]);
      await expect(stat(join(out, 'broker', 'RETRY.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      truncated = false;
      net.calls.length = 0;
      expect(await brokers(options)).toEqual({ fetched: 1 });
      expect(net.calls).toEqual(['/login/refresh', `RETRY/${old}`]);
      expect(
        await query(`SELECT date::VARCHAR date, ticker, side, broker, investor_type,
          shares, value, avg_price, freq FROM read_parquet('${join(data, 'parquet', 'brokers')}/*.parquet')
          WHERE ticker = 'RETRY' ORDER BY side`),
      ).toEqual([
        { date: old, ticker: 'RETRY', side: 'buy', ...buy },
        { date: old, ticker: 'RETRY', side: 'sell', ...sell },
      ]);
      expect(
        await query(`SELECT count(*)::INTEGER n FROM read_parquet('${coverage}')
        WHERE NOT complete`),
      ).toEqual([{ n: 0 }]);
      expect(JSON.parse(await readFile(join(out, 'broker', 'RETRY.json'), 'utf8'))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects wrong summary dates, symbols, row identities and duplicate brokers without saving partial pairs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brokers-invalid-'));
    const data = join(root, 'data');
    const token = join(root, 'stockbit.json');
    const out = join(root, 'private');
    const invalid = ['DATE', 'SYMBOL', 'ROWDATE', 'ROWSYMBOL', 'DUPLICATE', 'SELLCOUNT'];
    const net = network(token, (ticker, date) => {
      const result = summary(ticker, date);
      if (ticker === 'DATE') result.data.to = previous;
      if (ticker === 'SYMBOL') result.data.broker_summary.symbol = 'OTHER';
      if (ticker === 'ROWDATE')
        result.data.broker_summary.brokers_sell[0].netbs_date = previous.replaceAll('-', '');
      if (ticker === 'ROWSYMBOL')
        result.data.broker_summary.brokers_sell[0].netbs_stock_code = 'OTHER';
      if (ticker === 'DUPLICATE') {
        result.data.broker_summary.brokers_buy.push(result.data.broker_summary.brokers_buy[0]);
        result.data.bandar_detector.total_buyer = 2;
      }
      if (ticker === 'SELLCOUNT') result.data.bandar_detector.total_seller = 2;
      return Response.json(result);
    });
    try {
      await writeFile(token, JSON.stringify({ refresh: 'synthetic-refresh-0' }));
      await prices(
        data,
        [...invalid, 'GOOD'].map((ticker) => ({ ticker, date: day, volume: 100 })),
      );
      await expect(brokers({ data, token, out, fetcher: net.fetcher })).rejects.toThrow();
      expect(net.calls).toHaveLength(8);
      expect(
        await query(`SELECT ticker, count(*)::INTEGER n
          FROM read_parquet('${join(data, 'parquet', 'brokers')}/*.parquet') GROUP BY ticker`),
      ).toEqual([{ ticker: 'GOOD', n: 2 }]);
      expect(
        await query(`SELECT ticker FROM read_parquet('${join(data, 'parquet', 'broker-coverage.parquet')}')
          WHERE NOT complete ORDER BY ticker`),
      ).toEqual([...invalid].sort().map((ticker) => ({ ticker })));
      expect(await readdir(join(out, 'broker'))).toEqual(['GOOD.json']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
