import { DuckDBInstance } from '@duckdb/node-api';
import { expect, it } from 'vite-plus/test';
import { accumulation, analytics, marketSummary, schema } from './sql';

it('rejects gross or incomplete accumulation and computes buy size from window totals without dividing by zero', async () => {
  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  const output = async (sql: string) =>
    (
      await db.runAndReadAll(`SELECT to_json(r)::VARCHAR AS json FROM (${sql}) r`)
    ).getRowObjectsJson()[0]?.json;
  try {
    await db.run(schema);
    await db.run(`INSERT INTO prices (date, ticker, name, close, volume, value)
      SELECT DATE '2026-09-01' + (i * 2)::INTEGER, ticker, ticker || ' Company', 100 + i,
        CASE WHEN i < 20 THEN 100 ELSE 200 END, 1000 + i
      FROM range(25) n(i) CROSS JOIN (VALUES ('AAA'), ('BBB'), ('ZERO'), ('NEW'), ('IDLE')) t(ticker);
      DELETE FROM prices WHERE ticker = 'NEW' AND date = DATE '2026-09-01' + 46;
      UPDATE prices SET volume = 0 WHERE ticker = 'IDLE' OR (ticker = 'ZERO' AND date = DATE '2026-09-01' + 44);
      UPDATE prices SET frequency = CASE WHEN date = DATE '2026-10-19' THEN 10 ELSE 20 END;
      CREATE TABLE brokers (date DATE, ticker VARCHAR, board VARCHAR DEFAULT 'regular', side VARCHAR, broker VARCHAR, shares DOUBLE, freq DOUBLE);
      CREATE TABLE broker_pairs (date DATE, ticker VARCHAR, board VARCHAR, complete BOOLEAN);
      INSERT INTO broker_pairs SELECT date, ticker, 'regular', true FROM prices WHERE volume > 0;
      INSERT INTO brokers (date, ticker, side, broker, shares, freq)
      SELECT date, ticker, side, broker, shares,
        CASE WHEN broker = 'AA' THEN CASE WHEN date = DATE '2026-10-19' THEN 2 ELSE 6 END
          ELSE CASE WHEN date = DATE '2026-10-19' THEN 5 ELSE 2 END END FROM prices
      CROSS JOIN (VALUES ('buy', 'AA', 180), ('sell', 'AA', 170), ('buy', 'BB', 20), ('sell', 'CC', 30)) b(side,broker,shares)
      WHERE volume > 0;
      UPDATE brokers SET shares = 100 WHERE ticker = 'AAA' AND date = DATE '2026-10-19' AND side = 'buy' AND broker = 'BB';
      UPDATE brokers SET shares = 180 WHERE ticker = 'AAA' AND date = DATE '2026-10-19' AND side = 'sell' AND broker = 'AA';
      UPDATE brokers SET shares = 40 WHERE ticker = 'AAA' AND date = DATE '2026-10-17' AND side = 'sell' AND broker = 'AA';
      UPDATE brokers SET freq = 0 WHERE ticker = 'BBB' AND broker = 'BB' AND side = 'buy';
      UPDATE broker_pairs SET complete = false WHERE ticker = 'BBB' AND date = DATE '2026-09-01' + 44;
      INSERT INTO brokers SELECT date, ticker, 'negotiation', 'buy', 'XX', 1e9, 1 FROM prices WHERE volume > 0;`);
    await db.run(analytics);
    const publicJson = await output(marketSummary);
    expect(typeof publicJson).toBe('string');
    if (typeof publicJson !== 'string') throw new Error('Missing summary');
    const summary = JSON.parse(publicJson);
    expect(summary.date).toBe('2026-10-19');
    expect(summary.stocks.map((s: { ticker: string }) => s.ticker)).toEqual([
      'AAA',
      'BBB',
      'NEW',
      'ZERO',
    ]);
    const aaa = summary.stocks[0];
    expect(aaa.name).toBe('AAA Company');
    expect(aaa.close).toBe(124);
    expect(aaa.windows['1d'].change_pct).toBeCloseTo((124 / 123 - 1) * 100);
    expect(aaa.windows['3d'].change_pct).toBeCloseTo((124 / 121 - 1) * 100);
    expect(aaa.windows['5d'].change_pct).toBeCloseTo((124 / 119 - 1) * 100);
    expect(aaa.windows['1d'].value).toBe(1024);
    expect(aaa.windows['3d'].value).toBe(3069);
    expect(aaa.windows['5d'].value).toBe(5110);
    expect(aaa.windows['1d'].rel_volume).toBeCloseTo(200 / 120);
    expect(aaa.windows['3d'].rel_volume).toBeCloseTo(200 / 110);
    expect(aaa.windows['5d'].rel_volume).toBe(2);
    expect(summary.stocks[2].windows['3d'].value).toBeNull();
    expect(summary.stocks[2].windows['3d'].rel_volume).toBeNull();
    expect(summary.stocks[2].windows['1d'].rel_volume).toBeNull();
    expect(publicJson).not.toContain('broker');
    const privateJson = await output(accumulation);
    if (typeof privateJson !== 'string') throw new Error('Missing accumulation');
    const result = JSON.parse(privateJson);
    expect(result.date).toBe(summary.date);
    expect(result.stocks[0].windows).toEqual({
      '1d': {
        pct: 0.5,
        broker: 'BB',
        size: 1,
        broker_avg: 20,
        stock_avg: 20,
        buy_trades: 5,
        trades: 10,
      },
      '3d': {
        pct: 0.25,
        broker: 'AA',
        size: expect.closeTo(45 / 14),
        broker_avg: 540 / 14,
        stock_avg: 12,
        buy_trades: 14,
        trades: 50,
      },
      '5d': {
        pct: 0.18,
        broker: 'BB',
        size: expect.closeTo(81 / 65),
        broker_avg: 180 / 13,
        stock_avg: 1000 / 90,
        buy_trades: 13,
        trades: 90,
      },
    });
    expect(result.stocks[1].windows).toEqual({
      '1d': {
        pct: 0.1,
        broker: 'BB',
        size: null,
        broker_avg: null,
        stock_avg: 20,
        buy_trades: 0,
        trades: 10,
      },
      '3d': null,
      '5d': null,
    });
    expect(result.stocks[2].windows['3d']).toBeNull();
    expect(result.stocks[3].windows['5d']).toMatchObject({
      pct: 0.1,
      broker: 'BB',
      buy_trades: 11,
      trades: 90,
    });
    await db.run("UPDATE prices SET frequency = 0 WHERE ticker = 'AAA'");
    const zeroTrades = await output(accumulation);
    if (typeof zeroTrades !== 'string') throw new Error('Missing accumulation');
    expect(JSON.parse(zeroTrades).stocks[0].windows['3d']).toMatchObject({
      size: null,
      stock_avg: null,
      trades: 0,
    });
    await db.run("DELETE FROM brokers WHERE ticker = 'AAA' AND date = DATE '2026-10-19'");
    const missing = await output(accumulation);
    if (typeof missing !== 'string') throw new Error('Missing accumulation');
    expect(JSON.parse(missing).stocks[0].windows).toEqual({ '1d': null, '3d': null, '5d': null });
  } finally {
    db.closeSync();
    instance.closeSync();
  }
});
