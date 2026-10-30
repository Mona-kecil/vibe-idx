import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { dateValue, DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBValue } from '@duckdb/node-api';
import { AwsClient } from 'aws4fetch';
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
const boards = {
  regular: 'MARKET_BOARD_REGULER',
  negotiation: 'MARKET_BOARD_NEGO',
  cash: 'MARKET_BOARD_TUNAI',
} as const;
type Board = keyof typeof boards;
// Stockbit gives each ticker 10 requests, refilled at 10 a second.
const tickerInterval = 125;
const workers = 47;

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

export type R2 = {
  get(key: string): Promise<{ bytes: Buffer; etag: string } | undefined>;
  put(
    key: string,
    bytes: Buffer,
    condition?: { ifNoneMatch: '*' } | { ifMatch: string },
  ): Promise<string>;
  delete(key: string): Promise<void>;
};

export function createR2({
  accountId,
  accessKeyId = process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY,
  fetcher = fetch,
}: {
  accountId: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  fetcher?: typeof fetch;
}): R2 {
  if (!/^[a-zA-Z0-9]+$/.test(accountId)) throw new Error('Invalid R2 account ID');
  if (!accessKeyId || !secretAccessKey) throw new Error('Missing R2 credentials');
  const signer = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  async function request(method: string, key: string, init: RequestInit = {}, search = '') {
    const url = `https://${accountId}.r2.cloudflarestorage.com/vibe-idx-private/${key.split('/').map(encodeURIComponent).join('/')}${search}`;
    for (let attempt = 0; ; attempt++) {
      let result;
      try {
        const response = await fetcher(
          await signer.sign(url, {
            ...init,
            method,
            redirect: 'error',
            signal: AbortSignal.timeout(60000),
          }),
        );
        result = {
          status: response.status,
          headers: response.headers,
          bytes: Buffer.from(await response.arrayBuffer()),
        };
      } catch (error) {
        if (attempt >= 3) throw error;
      }
      if (result) {
        if (
          result.status === 412 &&
          attempt > 0 &&
          new Headers(init.headers).get('If-None-Match') === '*'
        ) {
          const saved = await client.get(key);
          if (
            saved &&
            init.body instanceof ArrayBuffer &&
            saved.bytes.equals(Buffer.from(init.body))
          )
            return {
              status: 200,
              headers: new Headers({ ETag: saved.etag }),
              bytes: Buffer.alloc(0),
            };
          throw new Error(`R2 create-once conflict: ${key}`);
        }
        if (result.status !== 429 && result.status < 500) return result;
        if (attempt >= 3) throw new Error(`R2 ${method} HTTP ${result.status}: ${key}`);
      }
      await setTimeout(250 * 2 ** attempt);
    }
  }
  function check(status: number, key: string) {
    if (status < 200 || status >= 300) throw new Error(`R2 HTTP ${status}: ${key}`);
  }
  function etag(headers: Headers, key: string) {
    const value = headers.get('ETag');
    if (!value) throw new Error(`Missing R2 ETag: ${key}`);
    return value;
  }
  const client: R2 = {
    async get(key) {
      const result = await request('GET', key);
      if (result.status === 404) return;
      check(result.status, key);
      return { bytes: result.bytes, etag: etag(result.headers, key) };
    },
    async put(key, bytes, condition) {
      const headers = new Headers();
      if (condition) {
        if ('ifMatch' in condition) headers.set('If-Match', condition.ifMatch);
        else headers.set('If-None-Match', condition.ifNoneMatch);
      }
      const result = await request('PUT', key, { body: new Uint8Array(bytes).buffer, headers });
      check(result.status, key);
      return etag(result.headers, key);
    },
    async delete(key) {
      const result = await request('DELETE', key);
      check(result.status, key);
    },
  };
  return client;
}

type BrokerSummary = {
  fetched: number;
  completed: number;
  pending: number;
  failed: { ticker: string; date: string; board: Board; error: string }[];
};

export class BrokerRunError extends Error {
  constructor(
    message: string,
    readonly summary: BrokerSummary,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

class StockbitError extends Error {
  readonly status: number | undefined;

  constructor(message: string, options?: ErrorOptions & { status?: number }) {
    super(message, options);
    this.status = options?.status;
  }
}

function summaryRows(
  ticker: string,
  day: string,
  board: Board,
  bytes: Uint8Array,
): DuckDBValue[][] {
  const pair = `${ticker}/${day}/${board}`;
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isObject(parsed) || !isObject(parsed.data))
    throw new Error(`Invalid broker response: ${pair}`);
  const result = parsed.data;
  if (result.from !== day || result.to !== day) throw new Error(`Broker date mismatch: ${pair}`);
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
  return sides.flatMap(({ side, source }) => {
    const prefix = side === 'buy' ? 'b' : 's';
    const codes = new Set<string>();
    return source.map((row: unknown) => {
      if (!isObject(row)) throw new Error(`Invalid broker row: ${pair}`);
      if (row.netbs_date !== day.replaceAll('-', ''))
        throw new Error(`Broker row date mismatch: ${pair}`);
      if (row.netbs_stock_code !== ticker) throw new Error(`Broker row symbol mismatch: ${pair}`);
      const broker = field(row, 'netbs_broker_code');
      if (codes.has(broker)) throw new Error(`Duplicate broker row: ${pair}`);
      codes.add(broker);
      return [
        dateValue(Date.parse(day) / 86400000),
        ticker,
        board,
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
}

export async function brokers({
  data,
  token,
  out,
  deadline,
  accountId,
  r2 = createR2({ accountId }),
  fetcher = fetch,
}: {
  data: string;
  token: string;
  out: string;
  deadline: number;
  accountId: string;
  r2?: R2;
  fetcher?: typeof fetch;
}) {
  const started = Date.now();
  const completedThrough = new Date(started - (10 * 60 + 17) * 60000).toISOString().slice(0, 10);
  if (await r2.get('broker-run.json'))
    throw new Error('Broker run marker requires operator review');
  const marker = Buffer.from(JSON.stringify({ id: randomUUID(), started }));
  try {
    await r2.put('broker-run.json', marker, { ifNoneMatch: '*' });
  } catch (error) {
    const saved = await r2.get('broker-run.json');
    if (saved?.bytes.equals(marker)) await r2.delete('broker-run.json');
    throw error;
  }
  try {
    return await collect();
  } finally {
    await r2.delete('broker-run.json');
  }

  async function collect() {
    const bounded = () => Date.now() >= deadline;
    async function stockbit(url: string, init: RequestInit, attempts = 1) {
      for (let attempt = 1; ; attempt++) {
        if (bounded()) return;
        let error: string;
        try {
          const response = await fetcher(url, {
            ...init,
            redirect: 'error',
            signal: AbortSignal.timeout(60000),
          });
          const result = {
            ok: response.ok,
            status: response.status,
            bytes: response.ok ? await response.bytes() : new Uint8Array(),
          };
          if (![500, 502, 503, 504].includes(result.status) || attempt >= attempts) return result;
          error = `Stockbit HTTP ${result.status}`;
        } catch (cause) {
          if (attempt >= attempts) throw new StockbitError(String(cause), { cause });
          error = String(cause);
        }
        if (bounded()) return;
        console.error(JSON.stringify({ url, attempt: attempt + 1, error }));
        await setTimeout(Math.min(1000 * 2 ** (attempt - 1), deadline - Date.now()));
      }
    }
    let access: string | undefined;
    let authentication: Promise<boolean> | undefined;
    async function authenticate() {
      const saved = await r2.get('auth/stockbit.json');
      if (!saved) throw new Error('Missing Stockbit token');
      const current: unknown = JSON.parse(saved.bytes.toString('utf8'));
      if (!isObject(current) || typeof current.refresh !== 'string' || !current.refresh)
        throw new Error('Invalid Stockbit token file');
      const auth = await stockbit('https://exodus.stockbit.com/login/refresh', {
        method: 'POST',
        headers: { ...headers, Authorization: `Bearer ${current.refresh}` },
      });
      if (!auth) return false;
      if (!auth.ok)
        throw new StockbitError(`Stockbit auth HTTP ${auth.status}`, { status: auth.status });
      const rotated = tokens(JSON.parse(new TextDecoder().decode(auth.bytes)));
      if (!rotated) throw new Error(`Invalid Stockbit auth HTTP ${auth.status}`);
      await mkdir(dirname(token), { recursive: true });
      await writeFile(token + '.tmp', JSON.stringify(rotated) + '\n', { mode: 0o600 });
      await chmod(token + '.tmp', 0o600);
      await rename(token + '.tmp', token);
      await r2.put('auth/stockbit.json', await readFile(token), { ifMatch: saved.etag });
      access = rotated.access;
      return true;
    }
    const instance = await DuckDBInstance.create(':memory:');
    const db = await instance.connect();
    const query = async (sql: string) => (await db.runAndReadAll(sql)).getRowObjectsJson();
    let fetched = 0;
    let completed = 0;
    async function brokerSummary(ticker: string, day: string, board: Board) {
      if (!(await (authentication ??= authenticate()))) return;
      const url = new URL(`https://exodus.stockbit.com/marketdetectors/${ticker}`);
      url.search = new URLSearchParams({
        from: day,
        to: day,
        transaction_type: 'TRANSACTION_TYPE_GROSS',
        market_board: boards[board],
        investor_type: 'INVESTOR_TYPE_ALL',
        limit: '200',
      }).toString();
      const response = await stockbit(
        url.href,
        { headers: { ...headers, Authorization: `Bearer ${access}` } },
        4,
      );
      if (!response) return;
      if (!response.ok)
        throw new StockbitError(`Stockbit HTTP ${response.status}`, { status: response.status });
      fetched++;
      return response.bytes;
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
      date DATE, ticker VARCHAR, board VARCHAR, side VARCHAR, broker VARCHAR, investor_type VARCHAR,
      shares DOUBLE, value DOUBLE, avg_price DOUBLE, freq DOUBLE,
      PRIMARY KEY(date, ticker, board, side, broker)
    );
    CREATE TABLE broker_pairs (
      date DATE, ticker VARCHAR, board VARCHAR, complete BOOLEAN, PRIMARY KEY(date, ticker, board)
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
      SELECT date, ticker, volume, frequency FROM read_parquet(${literal(join(data, 'parquet', 'prices', '*.parquet'))});
      ${marketCalendar}
      CREATE TEMP VIEW traded AS
      SELECT DISTINCT date, ticker
      FROM prices
      WHERE volume > 0 AND date >= DATE '2026-01-01'
        AND date <= DATE ${literal(completedThrough)};
      INSERT INTO broker_pairs
      SELECT date, ticker, board, false FROM traded
      CROSS JOIN (VALUES ${Object.keys(boards)
        .map((board) => `('${board}')`)
        .join(', ')}) b(board)
      ON CONFLICT DO NOTHING;
      UPDATE broker_pairs SET complete = true
      WHERE EXISTS (SELECT 1 FROM brokers
        WHERE brokers.date = broker_pairs.date AND brokers.ticker = broker_pairs.ticker
          AND brokers.board = broker_pairs.board)`);
      const entries = (
        await query(
          `WITH activity AS (
            SELECT ticker, sum(frequency) frequency FROM prices
            WHERE date >= DATE '2026-01-01' AND date < DATE '2027-01-01' GROUP BY ticker
          )
          SELECT ticker, date::VARCHAR date, board FROM broker_pairs
          JOIN traded USING(date, ticker) LEFT JOIN activity USING(ticker)
          WHERE NOT complete ORDER BY frequency DESC NULLS LAST, ticker, date DESC, board`,
        )
      ).map((entry) => {
        if (
          typeof entry.ticker !== 'string' ||
          !/^[A-Z0-9-]+$/.test(entry.ticker) ||
          typeof entry.date !== 'string' ||
          date(entry.date) !== entry.date ||
          !(typeof entry.board === 'string' && entry.board in boards)
        )
          throw new Error('Invalid broker target');
        return { ticker: entry.ticker, date: entry.date, board: entry.board as Board };
      });
      const years = new Map<string, boolean>();
      if (existsSync(parquet))
        for (const file of await readdir(parquet))
          if (file.endsWith('.parquet')) years.set(file.slice(0, -8), false);
      let lastCheckpoint = started;
      async function checkpoint() {
        for (const [year, changed] of years) {
          const file = join(parquet, `${year}.parquet`);
          if (changed) {
            await mkdir(dirname(file), { recursive: true });
            await db.run(`COPY (SELECT * FROM brokers WHERE year(date) = ${Number(year)} ORDER BY ALL)
              TO ${literal(file + '.tmp')} (FORMAT PARQUET, COMPRESSION ZSTD)`);
            await rename(file + '.tmp', file);
          }
          await r2.put(`parquet/brokers/${year}.parquet`, await readFile(file));
        }
        await mkdir(dirname(coverage), { recursive: true });
        await db.run(`COPY (SELECT * FROM broker_pairs ORDER BY ALL)
          TO ${literal(coverage + '.tmp')} (FORMAT PARQUET, COMPRESSION ZSTD)`);
        await rename(coverage + '.tmp', coverage);
        await r2.put('parquet/broker-coverage.parquet', await readFile(coverage));
        years.clear();
        lastCheckpoint = Date.now();
      }
      async function publish(ticker: string) {
        const rows = await output(`SELECT date, board,
        coalesce(list(struct_pack(broker := broker, investor_type := investor_type,
          shares := shares, value := value, avg_price := avg_price, freq := freq) ORDER BY broker)
          FILTER (WHERE side = 'buy'), []) buy,
        coalesce(list(struct_pack(broker := broker, investor_type := investor_type,
          shares := shares, value := value, avg_price := avg_price, freq := freq) ORDER BY broker)
          FILTER (WHERE side = 'sell'), []) sell
        FROM brokers
        WHERE ticker = ${literal(ticker)} AND date >= DATE '2026-01-01'
        GROUP BY date, board ORDER BY date DESC, board`);
        await mkdir(join(out, 'broker'), { recursive: true });
        const file = join(out, 'broker', `${ticker}.json`);
        await writeFile(file + '.tmp', `[${rows.join(',')}]\n`);
        await rename(file + '.tmp', file);
        await r2.put(`site/broker/${ticker}.json.gz`, gzipSync(await readFile(file)));
      }
      const groups = new Map<string, typeof entries>();
      for (const entry of entries) {
        const group = groups.get(entry.ticker) ?? [];
        group.push(entry);
        groups.set(entry.ticker, group);
      }
      const queue = [...groups];
      const failed: BrokerSummary['failed'] = [];
      let failure: Error | undefined;
      async function save(ticker: string, rows: DuckDBValue[][], pairs: typeof entries) {
        await db.run('BEGIN TRANSACTION');
        try {
          await append(rows);
          for (const pair of pairs)
            await db.run(`UPDATE broker_pairs SET complete = true
              WHERE date = ${literal(pair.date)} AND ticker = ${literal(ticker)}
                AND board = ${literal(pair.board)}`);
          await db.run('COMMIT');
        } catch (error) {
          await db.run('ROLLBACK');
          throw error;
        }
        if (rows.length) for (const pair of pairs) years.set(pair.date.slice(0, 4), true);
        completed += pairs.length;
        if (Date.now() - lastCheckpoint >= 10 * 60000) await checkpoint();
        await publish(ticker);
      }
      let saved = Promise.resolve();
      async function worker() {
        let next = 0;
        while (!failure && !bounded()) {
          const entry = queue.shift();
          if (!entry) return;
          const [ticker, group] = entry;
          const rows: DuckDBValue[][] = [];
          const pairs: typeof entries = [];
          try {
            for (const pair of group) {
              if (failure) break;
              await setTimeout(Math.min(Math.max(0, next - Date.now()), deadline - Date.now()));
              next = Date.now() + tickerInterval;
              const bytes = await brokerSummary(ticker, pair.date, pair.board);
              if (!bytes) break;
              try {
                rows.push(...summaryRows(ticker, pair.date, pair.board, bytes));
                pairs.push(pair);
              } catch (error) {
                failed.push({
                  ...pair,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
          } catch (error) {
            failure ??= error instanceof Error ? error : new Error(String(error));
          }
          if (pairs.length)
            saved = saved
              .then(() => save(ticker, rows, pairs))
              .catch((error: unknown) => {
                failure ??= error instanceof Error ? error : new Error(String(error));
              });
        }
      }
      await Promise.all(Array.from({ length: workers }, worker));
      await saved;
      await checkpoint();
      await mkdir(out, { recursive: true });
      const accumulationFile = join(out, 'market-accumulation.json');
      await writeFile(accumulationFile + '.tmp', `${(await output(accumulation))[0]}\n`);
      await rename(accumulationFile + '.tmp', accumulationFile);
      await r2.put('site/market-accumulation.json', await readFile(accumulationFile));
      const summary = { fetched, completed, pending: entries.length - completed, failed };
      if (failure || failed.length)
        throw new BrokerRunError(
          failure ? failure.message : `${failed.length} invalid broker pairs`,
          summary,
          { cause: failure },
        );
      return summary;
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
  const minutes = Number(process.env.BROKER_DEADLINE_MINUTES);
  if (!accountId || !Number.isFinite(minutes) || minutes <= 0)
    throw new Error('R2_ACCOUNT_ID and positive BROKER_DEADLINE_MINUTES are required');
  try {
    const summary = await brokers({
      data: resolve(values.data),
      token: resolve(values.token),
      out: resolve(values.out),
      accountId,
      deadline: Date.now() + (minutes * 60 - process.uptime()) * 1000,
    });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    if (error instanceof BrokerRunError) process.stdout.write(`${JSON.stringify(error.summary)}\n`);
    console.error(error);
    process.exitCode = 1;
  }
}
