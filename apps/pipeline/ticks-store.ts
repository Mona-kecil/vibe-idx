import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import { z } from 'zod';
import type { R2 } from './brokers';
import {
  bookColumns,
  siteSql,
  sessionDate,
  sqlLiteral as lit,
  tickerCode,
  tradeColumns,
} from './ticks-data';
import type { BookRow, Trade } from './ticks-data';

export const datasetSchema = z.enum(['running_trade', 'closing_book']);
export type Dataset = z.infer<typeof datasetSchema>;
const base = z.object({
  date: sessionDate,
  tickers: z.array(tickerCode),
  chunks: z.array(z.string().regex(/^chunk-\d+-\d+-\d+\.parquet$/)),
});
export const progressSchema = z.discriminatedUnion('dataset', [
  base.extend({
    dataset: z.literal('running_trade'),
    expected: z.number().int().nonnegative(),
    phase: z.enum(['bulk', 'repair']),
    cursor: z.number().int().nonnegative(),
    seen: z.array(z.number().int().nonnegative()),
    repairs: z.number().int().nonnegative(),
  }),
  base.extend({ dataset: z.literal('closing_book'), nextTicker: z.number().int().nonnegative() }),
]);
export type Progress = z.infer<typeof progressSchema>;
export type TradeProgress = Extract<Progress, { dataset: 'running_trade' }>;

export class TickStore {
  private constructor(
    readonly db: DuckDBConnection,
    private readonly instance: DuckDBInstance,
    private readonly data: string,
    private readonly r2: R2,
  ) {}

  static async open(data: string, r2: R2) {
    const instance = await DuckDBInstance.create(':memory:');
    const db = await instance.connect();
    const store = new TickStore(db, instance, data, r2);
    try {
      await db.run(`CREATE TABLE ledger (date DATE, ticker VARCHAR, dataset VARCHAR, row_count BIGINT,
        status VARCHAR, alerted BOOLEAN, PRIMARY KEY(date,ticker,dataset));
        CREATE TABLE running_trade (${tradeColumns}); CREATE TABLE closing_book (${bookColumns})`);
      const file = await store.download('ticks/ledger.parquet');
      if (file) await db.run(`INSERT INTO ledger SELECT * FROM read_parquet(${lit(file)})`);
      return store;
    } catch (error) {
      store.close();
      throw error;
    }
  }
  close() {
    this.db.closeSync();
    this.instance.closeSync();
  }
  async query(sql: string) {
    return (await this.db.runAndReadAll(sql)).getRowObjectsJson();
  }
  async download(key: string) {
    const object = await this.r2.get(key);
    if (!object) return;
    const file = join(this.data, key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, object.bytes);
    return file;
  }
  async saveLedger() {
    const file = join(this.data, 'ticks', 'ledger.parquet');
    await mkdir(dirname(file), { recursive: true });
    await this.db.run(`COPY (SELECT * FROM ledger ORDER BY date,ticker,dataset) TO ${lit(file)}
      (FORMAT PARQUET, COMPRESSION ZSTD)`);
    await this.r2.put('ticks/ledger.parquet', await readFile(file));
  }
  async targets(date: string, dataset: Dataset, tickers: string[]) {
    if (!tickers.length) return;
    await this.db
      .run(`INSERT INTO ledger SELECT ${lit(date)}::DATE,ticker,${lit(dataset)},0,'pending',false
      FROM (VALUES ${tickers.map((t) => `(${lit(t)})`).join(',')}) t(ticker) ON CONFLICT DO NOTHING`);
  }
  async complete(date: string, dataset: Dataset) {
    const result = await this
      .query(`SELECT count(*) > 0 AND bool_and(status IN ('complete','no_trades')) done
      FROM ledger WHERE date=${lit(date)} AND dataset=${lit(dataset)}`);
    return result[0].done === true;
  }
  async progress(date: string, dataset: Dataset) {
    const object = await this.r2.get(`staging/ticks/${dataset}/${date}/progress.json`);
    if (!object) return;
    const progress = progressSchema.parse(JSON.parse(object.bytes.toString('utf8')));
    if (progress.date !== date || progress.dataset !== dataset)
      throw new Error('Tick staging target mismatch');
    return progress;
  }
  private prefix(p: Progress) {
    return `staging/ticks/${p.dataset}/${p.date}`;
  }
  async restore(p: Progress) {
    await this.db.run(`DELETE FROM ${p.dataset}`);
    for (const chunk of p.chunks) {
      const file = await this.download(`${this.prefix(p)}/${chunk}`);
      if (!file) throw new Error(`Missing tick chunk: ${chunk}`);
      await this.merge(p.dataset, `read_parquet(${lit(file)})`);
    }
  }
  private async merge(dataset: Dataset, source: string) {
    if (dataset === 'closing_book') {
      await this.db.run(`INSERT INTO closing_book SELECT * FROM ${source}`);
      return;
    }
    await this.db.run(`CREATE OR REPLACE TEMP TABLE incoming AS SELECT * FROM ${source}`);
    const conflicts = await this
      .query(`SELECT count(*) n FROM incoming i JOIN running_trade t USING(trade_number)
      WHERE to_json(i) != to_json(t)`);
    if (Number(conflicts[0].n)) throw new Error('Conflicting duplicate trade numbers');
    const internal = await this.query(`SELECT trade_number FROM incoming GROUP BY trade_number
      HAVING count(DISTINCT to_json(incoming)) > 1 LIMIT 1`);
    if (internal.length) throw new Error('Conflicting trade numbers in page');
    await this.db.run(`INSERT INTO running_trade SELECT * FROM incoming
      QUALIFY row_number() OVER (PARTITION BY trade_number) = 1 ON CONFLICT DO NOTHING`);
  }
  async checkpoint(p: Progress, rows: Trade[] | BookRow[], start: number, end: number) {
    if (rows.length) {
      const chunk = `chunk-${p.chunks.length}-${start}-${end}.parquet`;
      const key = `${this.prefix(p)}/${chunk}`;
      const file = join(this.data, key);
      await mkdir(dirname(file), { recursive: true });
      const json = file + '.json';
      await writeFile(json, rows.map((r) => JSON.stringify(r)).join('\n'));
      try {
        // Cast into the authoritative schema before COPY; read_json inference alone can drift on empty/null fields.
        await this.db
          .run(`CREATE OR REPLACE TEMP TABLE chunk (${p.dataset === 'running_trade' ? tradeColumns.replace(' PRIMARY KEY', '') : bookColumns});
          INSERT INTO chunk SELECT * FROM read_json_auto(${lit(json)}, maximum_object_size=1048576)`);
        await this.merge(p.dataset, 'chunk');
        await this.db.run(`COPY chunk TO ${lit(file)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
        await this.r2.put(key, await readFile(file));
        p.chunks.push(chunk);
      } finally {
        await rm(json, { force: true });
      }
    }
    await this.r2.put(`${this.prefix(p)}/progress.json`, Buffer.from(JSON.stringify(p)));
    await this.db.run(`UPDATE ledger SET row_count = (SELECT count(*) FROM ${p.dataset} t
      WHERE t.ticker=ledger.ticker ${p.dataset === 'closing_book' ? "AND record_type='level'" : ''})
      WHERE date=${lit(p.date)} AND dataset=${lit(p.dataset)}`);
    await this.saveLedger();
  }
  /** Missing trade numbers, and for each second they fall in, a cursor one second earlier to re-read from. */
  async gaps(expected: number) {
    await this.db.run(`CREATE OR REPLACE TEMP TABLE missing AS
      SELECT n.trade_number, t.time FROM range(1, ${expected + 1}) n(trade_number)
      ASOF LEFT JOIN running_trade t ON n.trade_number >= t.trade_number
      WHERE NOT EXISTS (SELECT 1 FROM running_trade r WHERE r.trade_number = n.trade_number)`);
    const missing = (await this.query('SELECT trade_number FROM missing ORDER BY 1')).map((r) =>
      Number(r.trade_number),
    );
    const seconds = (
      await this.query(`SELECT m.time, coalesce((SELECT max(trade_number) FROM running_trade r
        WHERE r.time < m.time), 0) anchor FROM (SELECT DISTINCT coalesce(time, '00:00:00') AS time FROM missing) m
        ORDER BY m.time`)
    ).map((r) => ({ time: z.string().parse(r.time), anchor: Number(r.anchor) }));
    return { missing, seconds };
  }
  /** Uploads the per-ticker files the terminal reads; rerun on every recovery, so it must stay idempotent. */
  private async publishSite(date: string, dataset: Dataset) {
    const kind = dataset === 'running_trade' ? 'trades' : 'book';
    const files = (await this.query(siteSql[dataset])).map((r) => ({
      ticker: tickerCode.parse(r.ticker),
      json: z.string().parse(r.json),
    }));
    await Promise.all(
      Array.from({ length: 16 }, async () => {
        for (let file = files.pop(); file; file = files.pop())
          await this.r2.put(
            `site/ticks/${file.ticker}/${date}.${kind}.json.gz`,
            gzipSync(file.json),
          );
      }),
    );
  }
  private async finish(date: string, dataset: Dataset) {
    await this.publishSite(date, dataset);
    const tickers = (await this.query(`SELECT DISTINCT ticker FROM ${dataset}`)).map((r) =>
      tickerCode.parse(r.ticker),
    );
    await this.targets(date, dataset, tickers);
    await this.db
      .run(`UPDATE ledger SET row_count=(SELECT count(*) FROM ${dataset} t WHERE t.ticker=ledger.ticker
      ${dataset === 'closing_book' ? "AND record_type='level'" : ''}),
      status=CASE WHEN ${lit(dataset)}='running_trade' AND row_count=0 THEN 'no_trades' ELSE 'complete' END
      WHERE date=${lit(date)} AND dataset=${lit(dataset)}`);
    // DuckDB UPDATE expressions see old values: set status using the new count in a separate statement.
    if (dataset === 'running_trade')
      await this.db
        .run(`UPDATE ledger SET status=CASE WHEN row_count=0 THEN 'no_trades' ELSE 'complete' END
      WHERE date=${lit(date)} AND dataset=${lit(dataset)}`);
    await this.saveLedger();
  }
  async recoverPublished(date: string, dataset: Dataset) {
    const file = await this.download(`ticks/${dataset}/${date}.parquet`);
    if (!file) return false;
    await this.db.run(
      `DELETE FROM ${dataset}; INSERT INTO ${dataset} SELECT * FROM read_parquet(${lit(file)})`,
    );
    await this.finish(date, dataset);
    const progress = await this.progress(date, dataset);
    if (progress) await this.cleanup(progress);
    return true;
  }
  async publish(p: Progress, missing: number[] = []) {
    if (p.dataset === 'closing_book') {
      const [r] = await this.query(
        "SELECT count(DISTINCT ticker) n FROM closing_book WHERE record_type='snapshot'",
      );
      if (Number(r.n) !== p.tickers.length || p.nextTicker !== p.tickers.length)
        throw new Error('Incomplete closing book');
    }
    const key = `ticks/${p.dataset}/${p.date}.parquet`;
    const file = join(this.data, key);
    await mkdir(dirname(file), { recursive: true });
    await this.db
      .run(`COPY (SELECT * FROM ${p.dataset} ORDER BY ticker,${p.dataset === 'running_trade' ? 'trade_number' : 'side,level'})
      TO ${lit(file)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 65536${
        p.dataset === 'running_trade'
          ? `, KV_METADATA {expected: ${lit(String(p.expected))}, missing: ${lit(missing.join(','))}}`
          : ''
      })`);
    await this.r2.put(key, await readFile(file), { ifNoneMatch: '*' });
    await this.finish(p.date, p.dataset);
    await this.cleanup(p);
  }
  async cleanup(p: Progress) {
    for (const chunk of p.chunks) await this.r2.delete(`${this.prefix(p)}/${chunk}`);
    await this.r2.delete(`${this.prefix(p)}/progress.json`);
    await rm(join(this.data, this.prefix(p)), { recursive: true, force: true });
  }
}
