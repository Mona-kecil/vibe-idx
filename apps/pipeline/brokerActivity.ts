import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { DuckDBInstance, dateValue } from '@duckdb/node-api';
import type { DuckDBValue } from '@duckdb/node-api';
import { z } from 'zod';
import type { R2 } from './brokers';

const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const boardSchema = z.enum(['regular', 'negotiation', 'cash']);
const investorSchema = z.enum(['domestic', 'foreign']);
const daySchema = z.iso.date();
const code = z.string().regex(/^[A-Z0-9-]+$/);
const dayBoard = z.object({ date: daySchema, board: boardSchema });
const targetSchema = dayBoard.extend({ broker: code, investor: investorSchema });
type Target = z.infer<typeof targetSchema>;
const market = { regular: 'REGULER', negotiation: 'NEGO', cash: 'TUNAI' };
const numeric = z.number().finite().nonnegative();
const rowSchema = z.object({
  stock_code: code,
  broker_code: code,
  date: daySchema,
  type: z.enum(['BROKER_TYPE_LOCAL', 'BROKER_TYPE_FOREIGN', 'BROKER_TYPE_GOVERNMENT']),
  value: numeric,
  lot: numeric,
  avg_price: numeric,
  freq: numeric,
});
const activitySchema = z.object({
  data: z.object({
    from: daySchema,
    to: daySchema,
    broker_code: code,
    broker_activity_transaction: z.object({
      brokers_buy: z.array(rowSchema),
      brokers_sell: z.array(rowSchema),
    }),
  }),
});
const listSchema = z.object({
  data: z.object({
    date: z.object({ from: daySchema, to: daySchema }),
    list: z.array(z.object({ code })),
  }),
});
const pageLimit = 3000;
export const BROKER_ACTIVITY_RPS = 10;
export type ActivitySummary = {
  completed: number;
  pending: number;
  failed: { date: string; board: string; broker?: string; investor?: string; error: string }[];
};

export async function brokerActivity({
  data,
  dates,
  r2,
  request,
  deadline,
  rps = Number(process.env.BROKER_ACTIVITY_RPS ?? BROKER_ACTIVITY_RPS),
}: {
  data: string;
  dates: string[];
  r2: R2;
  deadline: number;
  rps?: number;
  request: (url: string) => Promise<Response | undefined>;
}): Promise<ActivitySummary> {
  if (!Number.isFinite(rps) || rps <= 0) throw new Error('BROKER_ACTIVITY_RPS must be positive');
  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  const query = async (sql: string) => (await db.runAndReadAll(sql)).getRowObjectsJson();
  const parquet = join(data, 'parquet', 'broker_activity');
  const coverage = join(data, 'parquet', 'broker-activity-coverage.parquet');
  const failed: ActivitySummary['failed'] = [];
  let completed = 0;
  let next = 0;
  let cooldown = 0;
  let gate = Promise.resolve();
  let lastCheckpoint = Date.now();
  const changed = new Set<string>();
  async function paced(url: URL): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const turn = gate.then(async () => {
        while (Date.now() < Math.max(next, cooldown) && Date.now() < deadline)
          await setTimeout(
            Math.min(Math.max(next, cooldown) - Date.now(), Math.max(0, deadline - Date.now())),
          );
        next = Date.now() + 1000 / rps;
      });
      gate = turn;
      await turn;
      if (Date.now() >= deadline) return;
      const response = await request(url.href);
      if (!response) return;
      const remaining = response.headers.get('x-rate-limit-remaining');
      if (remaining !== null && Number(remaining) <= 2)
        cooldown = Math.max(cooldown, Date.now() + 500);
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
        cooldown = Math.max(cooldown, Date.now() + 1000);
        await setTimeout(Math.min(1000, Math.max(0, deadline - Date.now())));
        continue;
      }
      if (!response.ok) throw new Error(`Stockbit activity HTTP ${response.status}`);
      return response.json();
    }
  }
  async function transaction(work: () => Promise<void>) {
    await db.run('BEGIN');
    try {
      await work();
      await db.run('COMMIT');
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  }
  async function checkpoint() {
    await mkdir(parquet, { recursive: true });
    for (const year of changed) {
      const file = join(parquet, `${year}.parquet`);
      await db.run(
        `COPY (SELECT * FROM broker_activity WHERE year(date) = ${Number(year)} ORDER BY date, ticker, board, broker, investor, side) TO ${literal(file + '.tmp')} (FORMAT PARQUET, COMPRESSION ZSTD)`,
      );
      await rename(file + '.tmp', file);
      await r2.put(`parquet/broker_activity/${year}.parquet`, await readFile(file));
    }
    await mkdir(dirname(coverage), { recursive: true });
    await db.run(`COPY (SELECT date, board, NULL::VARCHAR broker, NULL::VARCHAR investor, listed, NULL::BOOLEAN complete FROM activity_days
      UNION ALL SELECT date, board, broker, investor, NULL::BOOLEAN listed, complete FROM activity_targets)
      TO ${literal(coverage + '.tmp')} (FORMAT PARQUET, COMPRESSION ZSTD)`);
    await rename(coverage + '.tmp', coverage);
    await r2.put('parquet/broker-activity-coverage.parquet', await readFile(coverage));
    changed.clear();
    lastCheckpoint = Date.now();
  }
  async function activity(target: Target) {
    const rows: DuckDBValue[][] = [];
    const seen = new Set<string>();
    for (let page = 1; ; page++) {
      const url = new URL('https://exodus.stockbit.com/order-trade/broker/activity');
      url.search = new URLSearchParams({
        broker_code: target.broker,
        limit: String(pageLimit),
        page: String(page),
        transaction_type: 'TRANSACTION_TYPE_GROSS',
        market_board: `MARKET_TYPE_${market[target.board]}`,
        investor_type: `INVESTOR_TYPE_${target.investor.toUpperCase()}`,
        from: target.date,
        to: target.date,
      }).toString();
      const raw = await paced(url);
      if (raw === undefined) return;
      const result = activitySchema.parse(raw).data;
      if (
        result.from !== target.date ||
        result.to !== target.date ||
        result.broker_code !== target.broker
      )
        throw new Error('Activity target mismatch');
      const sides = {
        buy: result.broker_activity_transaction.brokers_buy,
        sell: result.broker_activity_transaction.brokers_sell,
      };
      for (const [side, source] of Object.entries(sides))
        for (const row of source) {
          if (row.date !== target.date || row.broker_code !== target.broker)
            throw new Error('Activity row target mismatch');
          const key = `${side}/${row.stock_code}`;
          if (seen.has(key)) throw new Error(`Duplicate activity row ${key}`);
          seen.add(key);
          const shares = row.lot * 100;
          if (!Number.isFinite(shares)) throw new Error('Invalid activity shares');
          rows.push([
            dateValue(Date.parse(target.date) / 86400000),
            target.broker,
            row.stock_code,
            target.board,
            target.investor,
            side,
            row.type.slice('BROKER_TYPE_'.length).toLowerCase(),
            shares,
            row.value,
            row.avg_price,
            row.freq,
          ]);
        }
      if (sides.buy.length < pageLimit && sides.sell.length < pageLimit) return rows;
    }
  }
  try {
    await db.run(`CREATE TABLE broker_activity (date DATE, broker VARCHAR, ticker VARCHAR, board VARCHAR, investor VARCHAR, side VARCHAR, broker_type VARCHAR, shares DOUBLE, value DOUBLE, avg_price DOUBLE, freq DOUBLE, PRIMARY KEY(date, broker, board, investor, side, ticker));
      CREATE TABLE activity_days (date DATE, board VARCHAR, listed BOOLEAN, PRIMARY KEY(date, board));
      CREATE TABLE activity_targets (date DATE, board VARCHAR, broker VARCHAR, investor VARCHAR, complete BOOLEAN, PRIMARY KEY(date, board, broker, investor))`);
    if (existsSync(parquet)) {
      if ((await readdir(parquet)).some((f) => f.endsWith('.parquet')))
        await db.run(
          `INSERT INTO broker_activity SELECT * FROM read_parquet(${literal(join(parquet, '*.parquet'))})`,
        );
    }
    if (existsSync(coverage))
      await db.run(`INSERT INTO activity_days SELECT date, board, listed FROM read_parquet(${literal(coverage)}) WHERE broker IS NULL;
      INSERT INTO activity_targets SELECT date, board, broker, investor, complete FROM read_parquet(${literal(coverage)}) WHERE broker IS NOT NULL`);
    for (const date of dates) {
      daySchema.parse(date);
      for (const board of boardSchema.options)
        await db.run(
          `INSERT INTO activity_days VALUES (${literal(date)}, ${literal(board)}, false) ON CONFLICT DO NOTHING`,
        );
    }
    const days = (
      await query(
        'SELECT date::VARCHAR date, board, listed FROM activity_days ORDER BY date DESC, board',
      )
    ).map((r) => dayBoard.extend({ listed: z.boolean() }).parse(r));
    for (const day of days) {
      if (Date.now() >= deadline) break;
      if (!day.listed) {
        try {
          const url = new URL('https://exodus.stockbit.com/order-trade/broker/top');
          url.search = new URLSearchParams({
            sort: 'TB_SORT_BY_TOTAL_VALUE',
            order: 'ORDER_BY_DESC',
            market_type: `MARKET_TYPE_${market[day.board]}`,
            from: day.date,
            to: day.date,
          }).toString();
          const raw = await paced(url);
          if (raw === undefined) break;
          const result = listSchema.parse(raw).data;
          if (result.date.from !== day.date || result.date.to !== day.date)
            throw new Error('Activity list date mismatch');
          if (new Set(result.list.map((r) => r.code)).size !== result.list.length)
            throw new Error('Duplicate listed broker');
          await transaction(async () => {
            for (const broker of result.list)
              for (const investor of investorSchema.options)
                await db.run(
                  `INSERT INTO activity_targets VALUES (${literal(day.date)}, ${literal(day.board)}, ${literal(broker.code)}, ${literal(investor)}, false)`,
                );
            await db.run(
              `UPDATE activity_days SET listed = true WHERE date = ${literal(day.date)} AND board = ${literal(day.board)}`,
            );
          });
        } catch (error) {
          failed.push({ date: day.date, board: day.board, error: String(error) });
          continue;
        }
      }
      const targets = (
        await query(
          `SELECT date::VARCHAR date, board, broker, investor FROM activity_targets WHERE date = ${literal(day.date)} AND board = ${literal(day.board)} AND NOT complete ORDER BY broker, investor`,
        )
      ).map((r) => targetSchema.parse(r));
      let saved = Promise.resolve();
      async function worker() {
        while (Date.now() < deadline) {
          const target = targets.shift();
          if (!target) return;
          try {
            const rows = await activity(target);
            if (!rows) return;
            const save = saved.then(async () => {
              await transaction(async () => {
                await db.run(
                  `DELETE FROM broker_activity WHERE date = ${literal(target.date)} AND board = ${literal(target.board)} AND broker = ${literal(target.broker)} AND investor = ${literal(target.investor)}`,
                );
                const appender = await db.createAppender('broker_activity');
                const types = Array.from({ length: appender.columnCount }, (_, i) =>
                  appender.columnType(i),
                );
                try {
                  for (const row of rows) {
                    row.forEach((v, i) => appender.appendValue(v, types[i]));
                    appender.endRow();
                  }
                } finally {
                  appender.closeSync();
                }
                await db.run(
                  `UPDATE activity_targets SET complete = true WHERE date = ${literal(target.date)} AND board = ${literal(target.board)} AND broker = ${literal(target.broker)} AND investor = ${literal(target.investor)}`,
                );
              });
              changed.add(target.date.slice(0, 4));
              completed++;
              if (Date.now() - lastCheckpoint >= 10 * 60000) await checkpoint();
            });
            saved = save.catch(() => {});
            await save;
          } catch (error) {
            failed.push({ ...target, error: String(error) });
          }
        }
      }
      await Promise.all(Array.from({ length: 10 }, worker));
      await saved;
      if (Date.now() - lastCheckpoint >= 10 * 60000) await checkpoint();
    }
    await checkpoint();
    const counts = await query(
      'SELECT (SELECT count(*) FROM activity_days WHERE NOT listed) + (SELECT count(*) FROM activity_targets WHERE NOT complete) pending',
    );
    return { completed, pending: Number(counts[0].pending), failed };
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}
