import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { DuckDBInstance } from '@duckdb/node-api';
import { AwsClient } from 'aws4fetch';
import { date } from './lib/rows';
import { publishBrokerActivity } from './broker-publication';
import { accumulation, marketCalendar } from './sql';
import { brokerActivity } from './brokerActivity';
import { checkRescales } from './rescale-check';
import { reportError, startSentry } from './lib/sentry';
import { collectTicks } from './ticks';
import type { ActivitySummary } from './brokerActivity';
import type { TickSummary } from './ticks';

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
      // A compressed response carries a weak ETag, which a later If-Match put can never satisfy.
      const result = await request('GET', key, { headers: { 'Accept-Encoding': 'identity' } });
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

type BrokerSummary = { activity: ActivitySummary; ticks?: TickSummary };

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
  const completedThrough = new Date(Date.now() - (10 * 60 + 17) * 60000).toISOString().slice(0, 10);
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
    // A run that refreshed but could not save to R2 still holds the live pair in its local file.
    const local: unknown = await readFile(token, 'utf8').then(JSON.parse, () => undefined);
    const candidates = [current.refresh];
    if (isObject(local) && typeof local.refresh === 'string' && local.refresh !== current.refresh)
      candidates.push(local.refresh);
    let auth: Awaited<ReturnType<typeof stockbit>>;
    for (const refresh of candidates) {
      auth = await stockbit('https://exodus.stockbit.com/login/refresh', {
        method: 'POST',
        headers: { ...headers, Authorization: `Bearer ${refresh}` },
      });
      if (!auth || auth.ok || ![401, 403].includes(auth.status)) break;
    }
    if (!auth) return false;
    if (!auth.ok)
      throw new StockbitError(`Stockbit auth HTTP ${auth.status}`, { status: auth.status });
    const rotated = tokens(JSON.parse(new TextDecoder().decode(auth.bytes)));
    if (!rotated) throw new Error(`Invalid Stockbit auth HTTP ${auth.status}`);
    await mkdir(dirname(token), { recursive: true });
    await writeFile(token + '.tmp', JSON.stringify(rotated) + '\n', { mode: 0o600 });
    await chmod(token + '.tmp', 0o600);
    await rename(token + '.tmp', token);
    const rotatedBytes = await readFile(token);
    try {
      await r2.put('auth/stockbit.json', rotatedBytes, { ifMatch: saved.etag });
    } catch (error) {
      // The refresh already revoked the stored pair, so keep the new one for an operator to restore.
      await r2.put('auth/stockbit-unsaved.json', rotatedBytes).catch(() => {});
      throw error;
    }
    access = rotated.access;
    return true;
  }
  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  const query = async (sql: string) => (await db.runAndReadAll(sql)).getRowObjectsJson();
  async function output(sql: string) {
    return (await query(`SELECT to_json(r)::VARCHAR AS json FROM (${sql}) r`)).map((r) => {
      if (typeof r.json !== 'string') throw new Error('Expected JSON from DuckDB');
      return r.json;
    });
  }
  let ticks: Promise<TickSummary> | undefined;
  try {
    await db.run(`CREATE TEMP VIEW prices AS
      SELECT date, ticker, volume, frequency FROM read_parquet(${literal(join(data, 'parquet', 'prices', '*.parquet'))});
      ${marketCalendar}
      CREATE TEMP VIEW traded AS SELECT DISTINCT date FROM prices
      WHERE volume > 0 AND date >= DATE '2026-01-01'
        AND date <= DATE ${literal(completedThrough)}`);
    const activityDates = (
      await query('SELECT DISTINCT date::VARCHAR date FROM traded ORDER BY date DESC')
    ).map((r) => {
      if (typeof r.date !== 'string' || date(r.date) !== r.date)
        throw new Error('Invalid activity date');
      return r.date;
    });
    // Running trade and order book requests use their own Stockbit rate buckets, so they run beside activity.
    ticks = collectTicks({
      data,
      r2,
      deadline,
      request: async (url, until) => {
        if (!(await (authentication ??= authenticate())) || Date.now() >= until) return;
        return fetcher(url, {
          headers: { ...headers, Authorization: `Bearer ${access}`, 'x-platform': 'web' },
          redirect: 'error',
          signal: AbortSignal.timeout(Math.max(1, Math.min(60000, until - Date.now()))),
        });
      },
    }).catch(async (error: unknown): Promise<TickSummary> => {
      await reportError(error, { source: 'ticks' });
      return { published: [], pending: [], stopped: String(error) };
    });
    const activity = await brokerActivity({
      data,
      dates: activityDates,
      r2,
      deadline,
      request: async (url) => {
        if (!(await (authentication ??= authenticate()))) return;
        return fetcher(url, {
          headers: { ...headers, Authorization: `Bearer ${access}` },
          redirect: 'error',
          signal: AbortSignal.timeout(60000),
        });
      },
    });
    const parquet = join(data, 'parquet', 'broker_activity');
    await db.run(`CREATE TEMP TABLE broker_activity (
      date DATE, ticker VARCHAR, board VARCHAR, side VARCHAR, broker VARCHAR, shares DOUBLE, freq DOUBLE
    )`);
    if (existsSync(parquet) && (await readdir(parquet)).some((file) => file.endsWith('.parquet')))
      await db.run(`INSERT INTO broker_activity SELECT date, ticker, board, side, broker, shares, freq
        FROM read_parquet(${literal(join(parquet, '*.parquet'))})`);
    await db.run(`CREATE TEMP VIEW broker_activity_coverage AS
      SELECT * FROM read_parquet(${literal(join(data, 'parquet', 'broker-activity-coverage.parquet'))})`);
    await mkdir(out, { recursive: true });
    const accumulationFile = join(out, 'market-accumulation.json');
    await writeFile(accumulationFile + '.tmp', `${(await output(accumulation))[0]}\n`);
    await rename(accumulationFile + '.tmp', accumulationFile);
    await r2.put('site/market-accumulation.json', await readFile(accumulationFile));
    await publishBrokerActivity(data, out, r2);
    await checkRescales({
      data,
      r2,
      access: async () => ((await (authentication ??= authenticate())) ? access : undefined),
      fetcher,
    }).catch((error) =>
      console.error(JSON.stringify({ check: 'broker-rescale', error: String(error) })),
    );
    const summary = { activity, ticks: await ticks };
    if (activity.failed.length || activity.stopped)
      throw new BrokerRunError(
        activity.stopped ?? `${activity.failed.length} activity failures`,
        summary,
      );
    return summary;
  } finally {
    // Close DuckDB only after the tick crawl's last Stockbit request settles.
    await ticks;
    db.closeSync();
    instance.closeSync();
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
  startSentry();
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
