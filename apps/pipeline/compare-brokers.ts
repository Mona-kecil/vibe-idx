import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { DuckDBInstance } from '@duckdb/node-api';

const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
export async function compareBrokers(data: string) {
  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  const query = async (sql: string) => (await db.runAndReadAll(sql)).getRowObjectsJson();
  try {
    const parquet = join(data, 'parquet');
    for (const folder of ['brokers', 'broker_activity', 'prices']) {
      const path = join(parquet, folder);
      if (!existsSync(path) || !(await readdir(path)).some((f) => f.endsWith('.parquet')))
        return {
          comparableDays: 0,
          adjusted: [],
          activityOnly: { instruments: 0, rows: 0 },
          dates: [],
          worst: [],
          volumeMismatches: [],
          failed: false,
        };
      await db.run(
        `CREATE VIEW ${folder} AS SELECT * FROM read_parquet(${literal(join(path, '*.parquet'))})`,
      );
    }
    for (const file of ['broker-coverage.parquet', 'broker-activity-coverage.parquet'])
      if (!existsSync(join(parquet, file)))
        return {
          comparableDays: 0,
          adjusted: [],
          activityOnly: { instruments: 0, rows: 0 },
          dates: [],
          worst: [],
          volumeMismatches: [],
          failed: false,
        };
    await db.run(`CREATE VIEW pairs AS SELECT * FROM read_parquet(${literal(join(parquet, 'broker-coverage.parquet'))});
      CREATE VIEW coverage AS SELECT * FROM read_parquet(${literal(join(parquet, 'broker-activity-coverage.parquet'))});
      CREATE TEMP VIEW comparable AS
      SELECT date, board FROM coverage d WHERE broker IS NULL AND listed
      AND NOT EXISTS (SELECT 1 FROM coverage t WHERE t.date=d.date AND t.board=d.board AND t.broker IS NOT NULL AND NOT coalesce(t.complete, false))
      AND NOT EXISTS (
        SELECT 1 FROM (SELECT date,ticker FROM prices WHERE volume > 0
          UNION SELECT date,ticker FROM brokers) tickers
        WHERE tickers.date=d.date AND NOT EXISTS (
          SELECT 1 FROM pairs p WHERE p.date=tickers.date AND p.ticker=tickers.ticker AND p.board=d.board AND p.complete))
      AND NOT EXISTS (SELECT 1 FROM pairs p WHERE p.date=d.date AND p.board=d.board AND NOT coalesce(p.complete, false))
      AND NOT EXISTS (SELECT 1 FROM broker_activity a WHERE a.date=d.date AND a.board=d.board
        AND NOT EXISTS (SELECT 1 FROM coverage t WHERE t.date=a.date AND t.board=a.board AND t.broker=a.broker AND t.investor=a.investor AND t.complete))
      AND NOT EXISTS (SELECT 1 FROM brokers b WHERE b.date=d.date AND b.board=d.board
        AND EXISTS (SELECT 1 FROM (VALUES ('domestic'),('foreign')) i(investor)
          WHERE NOT EXISTS (SELECT 1 FROM coverage t WHERE t.date=b.date AND t.board=b.board AND t.broker=b.broker AND t.investor=i.investor AND t.complete)));
      -- Per-broker data also covers instruments the per-stock collector never fetches (structured warrants, ETFs).
      CREATE TEMP VIEW universe AS
      SELECT DISTINCT date,board,ticker FROM (SELECT date,board,ticker FROM pairs UNION ALL SELECT date,board,ticker FROM brokers)
      JOIN comparable USING(date,board);
      CREATE TEMP VIEW comparison AS
      WITH a AS (SELECT date,ticker,board,side,broker,sum(shares) shares,sum(value) AS value,sum(freq) freq,true present FROM broker_activity JOIN universe USING(date,board,ticker) GROUP BY ALL),
      b AS (SELECT b.*,true present FROM brokers b JOIN comparable USING(date,board))
      SELECT coalesce(a.date,b.date) date,coalesce(a.ticker,b.ticker) ticker,coalesce(a.board,b.board) board,coalesce(a.side,b.side) side,coalesce(a.broker,b.broker) broker,
        a.shares activity_shares,b.shares brokers_shares,a.value activity_value,b.value brokers_value,a.freq activity_freq,b.freq brokers_freq,
        CASE WHEN a.present IS NULL THEN 'only-in-brokers' WHEN b.present IS NULL THEN 'only-in-activity'
          WHEN NOT (abs(a.value-b.value)<=1e-9*greatest(1,abs(a.value),abs(b.value))
            AND abs(a.freq-b.freq)<=1e-9*greatest(1,abs(a.freq),abs(b.freq))) THEN 'mismatched'
          WHEN abs(a.shares-b.shares)<=1e-9*greatest(1,abs(a.shares),abs(b.shares)) THEN 'matched'
          -- Stockbit rescales past share counts after a corporate action; the per-stock rows kept the day's count.
          ELSE 'adjusted' END status
      FROM a FULL OUTER JOIN b USING(date,ticker,board,side,broker)`);
    const counts = await query('SELECT count(*) n FROM comparable');
    const dates =
      await query(`SELECT date::VARCHAR date,count(*) FILTER (WHERE status='matched')::INTEGER AS "matched",
      count(*) FILTER (WHERE status='adjusted')::INTEGER AS adjusted,
      count(*) FILTER (WHERE status='mismatched')::INTEGER AS mismatched,
      count(*) FILTER (WHERE status='only-in-activity')::INTEGER AS only_in_activity,
      count(*) FILTER (WHERE status='only-in-brokers')::INTEGER AS only_in_brokers FROM comparison GROUP BY date ORDER BY date DESC`);
    const worst =
      await query(`SELECT * REPLACE(date::VARCHAR AS date) FROM comparison WHERE status NOT IN ('matched','adjusted')
      ORDER BY greatest(abs(coalesce(activity_value,0)-coalesce(brokers_value,0)),abs(coalesce(activity_shares,0)-coalesce(brokers_shares,0))) DESC LIMIT 20`);
    const volumeMismatches =
      await query(`WITH a AS (SELECT date,ticker,sum(shares) shares FROM broker_activity JOIN universe USING(date,board,ticker) WHERE board='regular' AND side='buy' GROUP BY ALL)
      SELECT coalesce(a.date,p.date)::VARCHAR date,coalesce(a.ticker,p.ticker) ticker,a.shares,p.volume,
        CASE WHEN p.ticker IS NULL THEN 'missing-price' ELSE 'volume-mismatch' END reason
      FROM a FULL OUTER JOIN (SELECT p.* FROM prices p WHERE EXISTS (SELECT 1 FROM comparable c WHERE c.date=p.date AND c.board='regular')) p USING(date,ticker)
      WHERE p.ticker IS NULL OR abs(coalesce(a.shares,0)-p.volume)>1e-9*greatest(1,abs(coalesce(a.shares,0)),abs(p.volume)) ORDER BY date DESC,ticker`);
    const adjusted =
      await query(`SELECT ticker, count(*)::INTEGER AS rows, min(date)::VARCHAR AS "first", max(date)::VARCHAR AS "last"
      FROM comparison WHERE status='adjusted' GROUP BY ticker ORDER BY ticker`);
    const [activityOnly] =
      await query(`SELECT count(DISTINCT ticker)::INTEGER instruments, count(*)::INTEGER AS rows
      FROM broker_activity a JOIN comparable USING(date,board)
      WHERE NOT EXISTS (SELECT 1 FROM universe u WHERE u.date=a.date AND u.board=a.board AND u.ticker=a.ticker)`);
    return {
      comparableDays: Number(counts[0].n),
      adjusted,
      activityOnly,
      dates,
      worst,
      volumeMismatches,
      failed: worst.length > 0,
    };
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((v) => v !== '--'),
    options: { data: { type: 'string' } },
  });
  if (!values.data) throw new Error('Usage: compare-brokers --data <dir>');
  const summary = await compareBrokers(resolve(values.data));
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (summary.failed) process.exitCode = 1;
}
