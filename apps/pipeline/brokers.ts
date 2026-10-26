import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { dateValue, DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBValue } from '@duckdb/node-api';
import { z } from 'zod';
import { date } from './lib/rows';
import { accumulation, marketCalendar } from './sql';

const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const headers = {
  Accept: 'application/json',
  Origin: 'https://stockbit.com',
  Referer: 'https://stockbit.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tokens(value: unknown, depth = 0): { access: string; refresh: string } | undefined {
  if (!isObject(value)) return;
  if (
    isObject(value.access) &&
    typeof value.access.token === 'string' &&
    value.access.token.length > 0 &&
    isObject(value.refresh) &&
    typeof value.refresh.token === 'string' &&
    value.refresh.token.length > 0
  )
    return { access: value.access.token, refresh: value.refresh.token };
  if (depth < 5) return tokens(value.data, depth + 1);
}

function field(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid broker field: ${key}`);
  return value;
}

function number(row: Record<string, unknown>, key: string): number {
  const value = Number(field(row, key));
  if (!Number.isFinite(value)) throw new Error(`Invalid broker number: ${key}`);
  return value;
}

export async function brokers({
  data,
  token,
  out,
  accountId,
  runKind,
  fetcher = fetch,
}: {
  data: string;
  token: string;
  out: string;
  accountId: string;
  runKind: 'daily' | 'backfill';
  fetcher?: typeof fetch;
}) {
  if (!/^[a-zA-Z0-9]+$/.test(accountId)) throw new Error('Invalid R2 account ID');
  const started = Date.now();
  let rpm = 20;
  const completedThrough = new Date(started - (10 * 60 + 17) * 60000).toISOString().slice(0, 10);
  const scratch = await mkdtemp(join(tmpdir(), 'broker-run-'));
  async function aws(operation: string, args: string[]) {
    return new Promise<string>((resolve, reject) => {
      execFile(
        'aws',
        [
          's3api',
          operation,
          '--endpoint-url',
          `https://${accountId}.r2.cloudflarestorage.com`,
          '--region',
          'auto',
          '--bucket',
          'vibe-idx-private',
          '--output',
          'json',
          ...args,
        ],
        { env: { ...process.env, AWS_MAX_ATTEMPTS: '1' } },
        (error, stdout, stderr) =>
          error ? reject(Object.assign(error, { stderr })) : resolve(stdout),
      );
    });
  }
  async function get(key: string) {
    const file = join(scratch, 'download');
    let metadata: unknown;
    try {
      metadata = JSON.parse(await aws('get-object', ['--key', key, file]));
    } catch (error) {
      if (isObject(error) && typeof error.stderr === 'string' && /\(NoSuchKey\)/.test(error.stderr))
        return;
      throw error;
    }
    if (!isObject(metadata) || typeof metadata.ETag !== 'string' || !metadata.ETag)
      throw new Error(`Missing R2 ETag: ${key}`);
    return { bytes: await readFile(file), etag: metadata.ETag };
  }
  async function put(key: string, file: string, condition: string[] = []) {
    await aws('put-object', ['--key', key, '--body', file, ...condition]);
  }
  async function verifiedPut(key: string, file: string, condition: string[]) {
    const bytes = await readFile(file);
    await put(key, file, condition);
    const saved = await get(key);
    if (!saved || !saved.bytes.equals(bytes)) throw new Error(`R2 readback mismatch: ${key}`);
    return saved;
  }
  try {
    if (await get('broker-run.json')) throw new Error('Broker run marker requires operator review');
    const marker = join(scratch, 'marker');
    await writeFile(marker, JSON.stringify({ id: randomUUID(), started }));
    await verifiedPut('broker-run.json', marker, ['--if-none-match', '*']);
    const rateFile = join(scratch, 'rpm');
    let rate = await get('broker-rpm.json');
    if (rate)
      rpm = z
        .union([z.literal(20), z.literal(15), z.literal(12)])
        .parse(JSON.parse(rate.bytes.toString('utf8')));
    else {
      await writeFile(rateFile, JSON.stringify(rpm));
      rate = await verifiedPut('broker-rpm.json', rateFile, ['--if-none-match', '*']);
    }
    console.error(JSON.stringify({ stockbit_rpm: rpm }));
    try {
      return await collect();
    } catch (error) {
      const nextRpm = rpm === 20 ? 15 : 12;
      if (nextRpm !== rpm) {
        console.error(
          JSON.stringify({ stockbit_rpm: rpm, next_stockbit_rpm: nextRpm, status: 'failed' }),
        );
        await writeFile(rateFile, JSON.stringify(nextRpm));
        await verifiedPut('broker-rpm.json', rateFile, ['--if-match', rate.etag]);
      }
      throw error;
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  async function collect() {
    let attempts = 0;
    let lastStart: number | undefined;
    const bounded = () => attempts >= 500 || Date.now() - started >= 50 * 60000;
    async function stockbit(url: string, init: RequestInit) {
      if (bounded()) return;
      const interval = 60000 / rpm;
      await setTimeout(
        lastStart === undefined ? interval : Math.max(0, lastStart + interval - Date.now()),
      );
      if (bounded()) return;
      lastStart = Date.now();
      attempts++;
      return fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(60000) });
    }
    let access: string | undefined;
    async function authenticate() {
      const saved = await get('auth/stockbit.json');
      if (!saved) throw new Error('Missing Stockbit token');
      const current: unknown = JSON.parse(saved.bytes.toString('utf8'));
      if (!isObject(current) || typeof current.refresh !== 'string' || !current.refresh)
        throw new Error('Invalid Stockbit token file');
      const auth = await stockbit('https://exodus.stockbit.com/login/refresh', {
        method: 'POST',
        headers: { ...headers, Authorization: `Bearer ${current.refresh}` },
      });
      if (!auth) return false;
      if (!auth.ok) throw new Error(`Stockbit auth HTTP ${auth.status}`);
      const rotated = tokens(await auth.json());
      if (!rotated) throw new Error(`Invalid Stockbit auth HTTP ${auth.status}`);
      await mkdir(dirname(token), { recursive: true });
      await writeFile(token + '.tmp', JSON.stringify(rotated) + '\n', { mode: 0o600 });
      await chmod(token + '.tmp', 0o600);
      await rename(token + '.tmp', token);
      await verifiedPut('auth/stockbit.json', token, ['--if-match', saved.etag]);
      access = rotated.access;
      return true;
    }
    const instance = await DuckDBInstance.create(':memory:');
    const db = await instance.connect();
    const query = async (sql: string) => (await db.runAndReadAll(sql)).getRowObjectsJson();
    let fetched = 0;
    let replayed = 0;
    let completed = 0;
    async function raw(path: string, url: string) {
      const key = `raw/broker/${path}`;
      const file = join(data, key);
      const cached = await get(key);
      if (cached) {
        if (existsSync(file) && !(await readFile(file)).equals(cached.bytes))
          throw new Error(`R2 raw conflict: ${key}`);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file + '.tmp', cached.bytes);
        await rename(file + '.tmp', file);
        return { bytes: cached.bytes, cached: true };
      }
      let bytes: Uint8Array;
      const local = existsSync(file);
      if (local) bytes = await readFile(file);
      else {
        if (!access && !(await authenticate())) return;
        const response = await stockbit(url, {
          headers: { ...headers, Authorization: `Bearer ${access}` },
        });
        if (!response) return;
        if (!response.ok) throw new Error(`Stockbit HTTP ${response.status}`);
        bytes = new Uint8Array(await response.arrayBuffer());
        fetched++;
      }
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file + '.tmp', bytes);
      await rename(file + '.tmp', file);
      await verifiedPut(key, file, ['--if-none-match', '*']);
      return { bytes, cached: local };
    }
    async function append(rows: DuckDBValue[][]) {
      const appender = await db.createAppender('brokers');
      const types = Array.from({ length: appender.columnCount }, (_, i) => appender.columnType(i));
      try {
        for (const row of rows) {
          for (const [i, value] of row.entries()) appender.appendValue(value, types[i]);
          appender.endRow();
        }
      } finally {
        appender.closeSync();
      }
    }
    async function output(sql: string) {
      return (await query(`SELECT to_json(r)::VARCHAR AS json FROM (${sql}) r`)).map((r) => {
        if (typeof r.json !== 'string') throw new Error('Expected JSON from DuckDB');
        return r.json;
      });
    }
    try {
      await db.run(`CREATE TABLE brokers (
      date DATE, ticker VARCHAR, side VARCHAR, broker VARCHAR, investor_type VARCHAR,
      shares DOUBLE, value DOUBLE, avg_price DOUBLE, freq DOUBLE,
      PRIMARY KEY(date, ticker, side, broker)
    );
    CREATE TABLE broker_pairs (
      date DATE, ticker VARCHAR, complete BOOLEAN, PRIMARY KEY(date, ticker)
    )`);
      const parquet = join(data, 'parquet', 'brokers');
      if (existsSync(parquet))
        await db.run(
          `INSERT INTO brokers SELECT * FROM read_parquet(${literal(join(parquet, '*.parquet'))})`,
        );
      const coverage = join(data, 'parquet', 'broker-coverage.parquet');
      if (existsSync(coverage))
        await db.run(`INSERT INTO broker_pairs SELECT * FROM read_parquet(${literal(coverage)})`);
      await db.run(`CREATE TEMP VIEW prices AS
      SELECT date, ticker, volume FROM read_parquet(${literal(join(data, 'parquet', 'prices', '*.parquet'))});
      ${marketCalendar}
      CREATE TEMP VIEW traded AS
      SELECT DISTINCT date, ticker
      FROM prices
      WHERE volume > 0 AND date >= DATE '2026-01-01'
        AND date <= DATE ${literal(completedThrough)};
      INSERT INTO broker_pairs
      SELECT date, ticker, false FROM traded
      ON CONFLICT DO NOTHING;
      UPDATE broker_pairs SET complete = true
      WHERE EXISTS (SELECT 1 FROM brokers
        WHERE brokers.date = broker_pairs.date AND brokers.ticker = broker_pairs.ticker)`);
      const entries = (
        await query(
          `SELECT ticker, date::VARCHAR date FROM broker_pairs
         JOIN traded USING(date, ticker) WHERE NOT complete ORDER BY date DESC, ticker`,
        )
      ).map((entry) => {
        if (
          typeof entry.ticker !== 'string' ||
          !/^[A-Z0-9-]+$/.test(entry.ticker) ||
          typeof entry.date !== 'string' ||
          date(entry.date) !== entry.date
        )
          throw new Error('Invalid broker target');
        return { ticker: entry.ticker, date: entry.date };
      });
      const years = new Map<string, boolean>();
      if (existsSync(parquet))
        for (const file of await readdir(parquet))
          if (file.endsWith('.parquet')) years.set(file.slice(0, -8), false);
      async function checkpoint() {
        for (const [year, changed] of years) {
          const file = join(parquet, `${year}.parquet`);
          if (changed) {
            await mkdir(dirname(file), { recursive: true });
            await db.run(`COPY (SELECT * FROM brokers WHERE year(date) = ${Number(year)} ORDER BY ALL)
          TO ${literal(file + '.tmp')} (FORMAT PARQUET, COMPRESSION ZSTD)`);
            await rename(file + '.tmp', file);
          }
          await put(`parquet/brokers/${year}.parquet`, file);
        }
        await mkdir(dirname(coverage), { recursive: true });
        await db.run(`COPY (SELECT * FROM broker_pairs ORDER BY ALL)
        TO ${literal(coverage + '.tmp')} (FORMAT PARQUET, COMPRESSION ZSTD)`);
        await rename(coverage + '.tmp', coverage);
        await put('parquet/broker-coverage.parquet', coverage);
        years.clear();
      }
      let failure: Error | undefined;
      try {
        if (runKind === 'daily') await authenticate();
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
      }
      for (const entry of entries) {
        if (failure || bounded()) break;
        const { ticker, date: day } = entry;
        const pair = `${ticker}/${day}`;
        try {
          const url = new URL(`https://exodus.stockbit.com/marketdetectors/${ticker}`);
          url.search = new URLSearchParams({
            from: day,
            to: day,
            transaction_type: 'TRANSACTION_TYPE_GROSS',
            market_board: 'MARKET_BOARD_ALL',
            investor_type: 'INVESTOR_TYPE_ALL',
            limit: '200',
          }).toString();
          const archived = await raw(`${day}/${ticker}.json`, url.href);
          if (!archived) break;
          const parsed: unknown = JSON.parse(new TextDecoder().decode(archived.bytes));
          if (!isObject(parsed) || !isObject(parsed.data))
            throw new Error(`Invalid broker response: ${pair}`);
          const result = parsed.data;
          if (result.from !== day || result.to !== day)
            throw new Error(`Broker date mismatch: ${pair}`);
          const summary = result.broker_summary;
          const counts = result.bandar_detector;
          if (
            !isObject(summary) ||
            !isObject(counts) ||
            !Array.isArray(summary.brokers_buy) ||
            !Array.isArray(summary.brokers_sell) ||
            !Number.isInteger(counts.total_buyer) ||
            !Number.isInteger(counts.total_seller) ||
            summary.brokers_buy.length !== counts.total_buyer ||
            summary.brokers_sell.length !== counts.total_seller
          )
            throw new Error(`Incomplete broker summary: ${pair}`);
          if (summary.symbol !== ticker) throw new Error(`Broker symbol mismatch: ${pair}`);
          const sides = [
            { side: 'buy', source: summary.brokers_buy },
            { side: 'sell', source: summary.brokers_sell },
          ];
          const rows = sides.flatMap(({ side, source }) => {
            const prefix = side === 'buy' ? 'b' : 's';
            const codes = new Set<string>();
            return source.map((row: unknown) => {
              if (!isObject(row)) throw new Error(`Invalid broker row: ${pair}`);
              if (row.netbs_date !== day.replaceAll('-', ''))
                throw new Error(`Broker row date mismatch: ${pair}`);
              if (row.netbs_stock_code !== ticker)
                throw new Error(`Broker row symbol mismatch: ${pair}`);
              const broker = field(row, 'netbs_broker_code');
              if (codes.has(broker)) throw new Error(`Duplicate broker row: ${pair}`);
              codes.add(broker);
              return [
                dateValue(Date.parse(day) / 86400000),
                ticker,
                side,
                broker,
                field(row, 'type'),
                number(row, `${prefix}lotv`),
                number(row, `${prefix}val`),
                number(row, `netbs_${side}_avg_price`),
                number(row, 'freq'),
              ];
            });
          });
          await db.run('BEGIN TRANSACTION');
          try {
            await append(rows);
            await db.run(`UPDATE broker_pairs SET complete = true
            WHERE date = ${literal(day)} AND ticker = ${literal(ticker)}`);
            await db.run('COMMIT');
          } catch (error) {
            await db.run('ROLLBACK');
            throw error;
          }
          if (rows.length) years.set(day.slice(0, 4), true);
          if (archived.cached) replayed++;
          completed++;
        } catch (error) {
          failure = new Error(`${pair}: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
        if (completed % 25 === 0) await checkpoint();
      }
      await checkpoint();
      const tickers = await query(
        'SELECT ticker FROM brokers UNION SELECT ticker FROM broker_pairs WHERE complete',
      );
      for (const { ticker } of tickers) {
        if (typeof ticker !== 'string') throw new Error('Expected broker ticker');
        const rows = await output(`SELECT date,
        coalesce(list(struct_pack(broker := broker, investor_type := investor_type,
          shares := shares, value := value, avg_price := avg_price, freq := freq) ORDER BY broker)
          FILTER (WHERE side = 'buy'), []) buy,
        coalesce(list(struct_pack(broker := broker, investor_type := investor_type,
          shares := shares, value := value, avg_price := avg_price, freq := freq) ORDER BY broker)
          FILTER (WHERE side = 'sell'), []) sell
        FROM (SELECT date, ticker FROM brokers
          UNION SELECT date, ticker FROM broker_pairs WHERE complete) days
        LEFT JOIN brokers USING(date, ticker)
        WHERE ticker = ${literal(ticker)}
          AND date >= DATE '2026-01-01'
        GROUP BY date ORDER BY date DESC`);
        await mkdir(join(out, 'broker'), { recursive: true });
        const file = join(out, 'broker', `${ticker}.json`);
        await writeFile(file + '.tmp', `[${rows.join(',')}]\n`);
        await rename(file + '.tmp', file);
        await put(`site/broker/${ticker}.json`, file);
      }
      const accumulationFile = join(out, 'market-accumulation.json');
      await writeFile(accumulationFile + '.tmp', `${(await output(accumulation))[0]}\n`);
      await rename(accumulationFile + '.tmp', accumulationFile);
      await put('site/market-accumulation.json', accumulationFile);
      if (failure) throw failure;
      const pending = entries.length - completed;
      await aws('delete-object', ['--key', 'broker-run.json']);
      return { fetched, replayed, completed, pending };
    } finally {
      db.closeSync();
      instance.closeSync();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((s) => s !== '--'),
    options: {
      data: { type: 'string' },
      token: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (!values.data || !values.token || !values.out)
    throw new Error('Usage: brokers -- --data <dir> --token <file> --out <private dir>');
  const accountId = process.env.R2_ACCOUNT_ID;
  const runKind = process.env.BROKER_RUN_KIND;
  if (!accountId || (runKind !== 'daily' && runKind !== 'backfill'))
    throw new Error('R2_ACCOUNT_ID and BROKER_RUN_KIND (daily or backfill) are required');
  process.stdout.write(
    `${JSON.stringify(await brokers({ data: resolve(values.data), token: resolve(values.token), out: resolve(values.out), accountId, runKind }))}\n`,
  );
}
