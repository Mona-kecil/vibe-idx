import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DuckDBInstance } from '@duckdb/node-api';
import { z } from 'zod';
import type { R2 } from './brokers';

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const manifestSchema = z.record(z.string(), z.string());
const code = z.string().regex(/^[A-Z0-9-]{1,12}$/);

/**
 * Uploads only the files whose body changed since the last manifest. The manifest is written after
 * every upload, so an interrupted publication retries the rest on the next run.
 */
async function publishChanged(
  r2: R2,
  out: string,
  { manifest, folder }: { manifest: string; folder: string },
  files: AsyncIterable<{ name: string; body: string }>,
) {
  const saved = await r2.get(manifest);
  const previous = saved ? manifestSchema.parse(JSON.parse(saved.bytes.toString())) : {};
  const next: Record<string, string> = {};
  await mkdir(join(out, folder), { recursive: true });
  const changed: string[] = [];
  for await (const { name, body } of files) {
    const hash = createHash('sha256').update(body).digest('hex');
    next[name] = hash;
    if (previous[name] === hash) continue;
    const file = join(out, folder, `${name}.json`);
    await writeFile(file + '.tmp', body);
    await rename(file + '.tmp', file);
    changed.push(name);
  }
  // One at a time, a day's new data (about 950 tickers) took over 30 minutes to upload.
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      for (let name = changed.shift(); name; name = changed.shift())
        await r2.put(
          `site/${folder}/${name}.json.gz`,
          gzipSync(await readFile(join(out, folder, `${name}.json`))),
        );
    }),
  );
  await r2.put(manifest, Buffer.from(JSON.stringify(next)));
}

export async function publishBrokerActivity(data: string, out: string, r2: R2) {
  const parquet = join(data, 'parquet', 'broker_activity');
  const coverage = join(data, 'parquet', 'broker-activity-coverage.parquet');
  if (!existsSync(coverage) || !existsSync(parquet)) return;
  if (!(await readdir(parquet)).some((file) => file.endsWith('.parquet'))) return;
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
    await publishChanged(
      r2,
      out,
      { manifest: 'site/broker-activity-publication.json', folder: 'broker' },
      (async function* () {
        for (const row of tickers) {
          const ticker = code.parse(row.ticker);
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
          yield { name: ticker, body: z.string().parse(result.getRowObjectsJson()[0].body) + '\n' };
        }
      })(),
    );
    // One file per broker with what it bought and sold in each ticker, summed over client domiciles.
    // Built one broker at a time: every broker's lists in one query took over 12 GB.
    await db.run(`CREATE TABLE broker_rows AS SELECT broker, date, board, ticker,
        coalesce(sum(value) FILTER (WHERE side = 'buy'), 0) buy_value,
        coalesce(sum(shares) FILTER (WHERE side = 'buy'), 0) buy_shares,
        coalesce(sum(value) FILTER (WHERE side = 'sell'), 0) sell_value,
        coalesce(sum(shares) FILTER (WHERE side = 'sell'), 0) sell_shares
      FROM complete_rows GROUP BY broker, date, board, ticker ORDER BY broker, date DESC, board, ticker`);
    const brokers = (
      await db.runAndReadAll('SELECT DISTINCT broker FROM broker_rows ORDER BY broker')
    ).getRowObjectsJson();
    await publishChanged(
      r2,
      out,
      { manifest: 'site/broker-ledger-publication.json', folder: 'broker-ledger' },
      (async function* () {
        for (const row of brokers) {
          const broker = code.parse(row.broker);
          const result = await db.runAndReadAll(`SELECT to_json({broker: ${literal(broker)},
            days: list({date: date::VARCHAR, board: board, ticker: ticker, buy_value: buy_value,
              buy_shares: buy_shares, sell_value: sell_value, sell_shares: sell_shares}
              ORDER BY date DESC, board)})::VARCHAR body FROM (
            SELECT date, board, list(ticker ORDER BY ticker) ticker,
              list(buy_value ORDER BY ticker) buy_value, list(buy_shares ORDER BY ticker) buy_shares,
              list(sell_value ORDER BY ticker) sell_value, list(sell_shares ORDER BY ticker) sell_shares
            FROM broker_rows WHERE broker = ${literal(broker)} GROUP BY date, board)`);
          yield {
            name: broker,
            body: z.string().parse(result.getRowObjectsJson()[0]?.body) + '\n',
          };
        }
      })(),
    );
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}
