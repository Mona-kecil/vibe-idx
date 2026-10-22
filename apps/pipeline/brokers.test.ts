import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vite-plus/test';
import { brokers } from './brokers';

function summary(ticker: string, day: string) {
  return {
    data: {
      from: day,
      to: day,
      bandar_detector: { total_buyer: 1, total_seller: 1 },
      broker_summary: {
        symbol: ticker,
        brokers_buy: [
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
        brokers_sell: [
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

describe('private broker pipeline', () => {
  it('saves rotated tokens before broker requests and prevents duplicate rows on replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brokers-replay-'));
    const data = join(root, 'data');
    const out = join(root, 'private');
    const feed = join(root, 'public', 'feed.json');
    const token = join(data, 'stockbit.json');
    const day = new Date().toISOString().slice(0, 10);
    const previous = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const old = `${Number(day.slice(0, 4)) - 1}-01-02`;
    const targets = [
      { ticker: 'TEST', date: previous, kind: 'ara' },
      { ticker: 'TEST', date: day, kind: 'ara' },
      { ticker: 'TEST', date: day, kind: 'volume_spike' },
      { ticker: 'TEST', date: old, kind: 'ara' },
      { ticker: 'OTHER', date: day, kind: 'ara' },
    ];
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
      calls.push(url.pathname);
      if (url.pathname === '/login/refresh') {
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
      const requested = url.searchParams.get('from');
      if (!requested) throw new Error('Missing broker date');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        from: requested,
        to: requested,
        transaction_type: 'TRANSACTION_TYPE_GROSS',
        market_board: 'MARKET_BOARD_ALL',
        investor_type: 'INVESTOR_TYPE_ALL',
        limit: '200',
      });
      return Response.json(summary(ticker, requested));
    };
    try {
      await mkdir(data, { recursive: true });
      await mkdir(join(root, 'public'));
      await writeFile(
        token,
        JSON.stringify({ access: 'synthetic-access-0', refresh: 'synthetic-refresh-0' }),
      );
      await writeFile(feed, JSON.stringify(targets));
      const options = { data, feed, token, out, fetcher };
      expect(await brokers(options)).toEqual({ fetched: 4 });
      expect(calls[0]).toBe('/login/refresh');
      expect(calls).toHaveLength(5);
      expect(
        JSON.parse(await readFile(join(data, 'raw', 'broker', day, 'TEST.json'), 'utf8')),
      ).toEqual(summary('TEST', day));
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
      expect(JSON.parse(await readFile(join(out, 'broker', 'TEST.json'), 'utf8'))).toEqual([
        { date: day, buy: [buy], sell: [sell] },
        { date: previous, buy: [buy], sell: [sell] },
      ]);
      expect(JSON.parse(await readFile(join(out, 'broker', 'OTHER.json'), 'utf8'))).toEqual([
        { date: day, buy: [buy], sell: [sell] },
      ]);
      expect(await readdir(join(root, 'public'))).toEqual(['feed.json']);
      const ledger = join(data, 'parquet', 'brokers');
      const instance = await DuckDBInstance.create(':memory:');
      const db = await instance.connect();
      try {
        const rows = (
          await db.runAndReadAll(`SELECT date::VARCHAR date, ticker, side, broker,
          investor_type, shares, value, avg_price, freq FROM read_parquet('${ledger}/*.parquet')`)
        ).getRowObjectsJson();
        expect(rows).toHaveLength(8);
        for (const target of [targets[0], targets[1], targets[3], targets[4]]) {
          expect(rows).toContainEqual({
            date: target.date,
            ticker: target.ticker,
            side: 'buy',
            ...buy,
          });
          expect(rows).toContainEqual({
            date: target.date,
            ticker: target.ticker,
            side: 'sell',
            ...sell,
          });
        }
      } finally {
        db.closeSync();
        instance.closeSync();
      }
      const files = (await readdir(ledger)).map((file) => join(ledger, file));
      const before = await Promise.all(
        files.map(async (file) => ({
          bytes: await readFile(file),
          mtime: (await stat(file)).mtimeMs,
        })),
      );
      const outputBefore = await readFile(join(out, 'broker', 'TEST.json'));
      await rm(join(data, 'raw'), { recursive: true });
      calls.length = 0;
      expect(await brokers(options)).toEqual({ fetched: 0 });
      expect(calls).toEqual(['/login/refresh']);
      expect(JSON.parse(await readFile(token, 'utf8'))).toEqual({
        access: 'synthetic-access-2',
        refresh: 'synthetic-refresh-2',
      });
      expect(
        await Promise.all(
          files.map(async (file) => ({
            bytes: await readFile(file),
            mtime: (await stat(file)).mtimeMs,
          })),
        ),
      ).toEqual(before);
      expect(await readFile(join(out, 'broker', 'TEST.json'))).toEqual(outputBefore);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps complete pairs and fails the run when one broker summary is truncated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brokers-truncated-'));
    const token = join(root, 'stockbit.json');
    const feed = join(root, 'feed.json');
    const day = new Date().toISOString().slice(0, 10);
    const truncated = summary('BAD', day);
    truncated.data.bandar_detector.total_buyer = 2;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === '/login/refresh')
        return Response.json({
          data: {
            access: { token: 'synthetic-access-1' },
            refresh: { token: 'synthetic-refresh-1' },
          },
        });
      return Response.json(url.pathname.endsWith('/BAD') ? truncated : summary('GOOD', day));
    };
    try {
      await writeFile(
        token,
        JSON.stringify({ access: 'synthetic-access-0', refresh: 'synthetic-refresh-0' }),
      );
      await writeFile(
        feed,
        JSON.stringify([
          { ticker: 'BAD', date: day },
          { ticker: 'GOOD', date: day },
        ]),
      );
      const options = { data: root, feed, token, out: join(root, 'private'), fetcher };
      await expect(brokers(options)).rejects.toThrow(`Incomplete broker summary: BAD/${day}`);
      expect(JSON.parse(await readFile(token, 'utf8'))).toEqual({
        access: 'synthetic-access-1',
        refresh: 'synthetic-refresh-1',
      });
      const instance = await DuckDBInstance.create(':memory:');
      const db = await instance.connect();
      try {
        const tickers = (
          await db.runAndReadAll(
            `SELECT DISTINCT ticker FROM read_parquet('${join(root, 'parquet', 'brokers')}/*.parquet')`,
          )
        ).getRowObjectsJson();
        expect(tickers).toEqual([{ ticker: 'GOOD' }]);
      } finally {
        db.closeSync();
        instance.closeSync();
      }
      await expect(stat(join(options.out, 'broker', 'BAD.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
