import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DuckDBInstance } from '@duckdb/node-api';
import { z } from 'zod';
import type { R2 } from './brokers';

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const manifestKey = 'site/broker-activity-publication.json';
const manifestSchema = z.record(z.string(), z.string());

export async function publishBrokerActivity(data: string, out: string, r2: R2) {
  const parquet = join(data, 'parquet', 'broker_activity');
  const coverage = join(data, 'parquet', 'broker-activity-coverage.parquet');
  if (!existsSync(coverage) || !existsSync(parquet)) return;
  if (!(await readdir(parquet)).some((file) => file.endsWith('.parquet'))) return;
  const saved = await r2.get(manifestKey);
  const previous = saved ? manifestSchema.parse(JSON.parse(saved.bytes.toString())) : {};
  const next: Record<string, string> = {};
  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  try {
    await db.run(`CREATE VIEW activity AS SELECT * FROM read_parquet(${literal(join(parquet, '*.parquet'))})
      WHERE date >= DATE '2026-01-01';
      CREATE VIEW coverage AS SELECT * FROM read_parquet(${literal(coverage)});
      CREATE TABLE complete_rows AS SELECT a.* FROM activity a
      JOIN coverage d ON a.date = d.date AND a.board = d.board AND d.broker IS NULL AND d.listed
      WHERE NOT EXISTS (SELECT 1 FROM coverage t WHERE t.date = a.date AND t.board = a.board
        AND t.broker IS NOT NULL AND t.complete IS DISTINCT FROM true)
      ORDER BY a.ticker, a.date, a.board, a.broker, a.investor, a.side`);
    const tickers = (
      await db.runAndReadAll('SELECT DISTINCT ticker FROM activity ORDER BY ticker')
    ).getRowObjectsJson();
    await mkdir(join(out, 'broker'), { recursive: true });
    const changed: string[] = [];
    for (const row of tickers) {
      const ticker = z
        .string()
        .regex(/^[A-Z0-9-]{1,12}$/)
        .parse(row.ticker);
      const result =
        await db.runAndReadAll(`SELECT to_json(coalesce(list(day ORDER BY day.date DESC, day.board), [])) body FROM (
        SELECT date, board,
          coalesce(list(struct_pack(broker := broker, investor := investor, broker_type := broker_type,
            shares := shares, value := value, avg_price := avg_price, freq := freq) ORDER BY broker, investor)
            FILTER (WHERE side = 'buy'), []) buy,
          coalesce(list(struct_pack(broker := broker, investor := investor, broker_type := broker_type,
            shares := shares, value := value, avg_price := avg_price, freq := freq) ORDER BY broker, investor)
            FILTER (WHERE side = 'sell'), []) sell
        FROM complete_rows WHERE ticker = ${literal(ticker)} GROUP BY date, board
      ) day`);
      const body = z.string().parse(result.getRowObjectsJson()[0].body) + '\n';
      const hash = createHash('sha256').update(body).digest('hex');
      next[ticker] = hash;
      if (previous[ticker] === hash) continue;
      const file = join(out, 'broker', `${ticker}.json`);
      await writeFile(file + '.tmp', body);
      await rename(file + '.tmp', file);
      changed.push(ticker);
    }
    // One at a time, a day's new data (about 950 tickers) took over 30 minutes to upload.
    await Promise.all(
      Array.from({ length: 16 }, async () => {
        for (let ticker = changed.shift(); ticker; ticker = changed.shift())
          await r2.put(
            `site/broker/${ticker}.json.gz`,
            gzipSync(await readFile(join(out, 'broker', `${ticker}.json`))),
          );
      }),
    );
    // Commit hashes only after every upload, so an interrupted publication retries on the next run.
    await r2.put(manifestKey, Buffer.from(JSON.stringify(next)));
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}
