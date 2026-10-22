/// <reference types="node" />
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { dateValue, DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBValue } from '@duckdb/node-api';
import { date } from '../web/convex/lib/rows';

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
  feed,
  token,
  out,
  fetcher = fetch,
}: {
  data: string;
  feed: string;
  token: string;
  out: string;
  fetcher?: typeof fetch;
}) {
  const current: unknown = await readFile(token, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => null);
  if (!isObject(current) || typeof current.refresh !== 'string')
    throw new Error('Invalid Stockbit token file');
  const auth = await fetcher('https://exodus.stockbit.com/login/refresh', {
    method: 'POST',
    headers: { ...headers, Authorization: `Bearer ${current.refresh}` },
    redirect: 'error',
    signal: AbortSignal.timeout(60000),
  });
  if (!auth.ok) throw new Error(`Stockbit auth HTTP ${auth.status}`);
  const rotated = tokens(await auth.json().catch(() => null));
  if (!rotated) throw new Error(`Stockbit auth HTTP ${auth.status}`);
  const { access } = rotated;
  await writeFile(token + '.tmp', JSON.stringify(rotated) + '\n', { mode: 0o600 });
  await chmod(token + '.tmp', 0o600);
  await rename(token + '.tmp', token);

  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  const query = async (sql: string) => (await db.runAndReadAll(sql)).getRowObjectsJson();
  let fetched = 0;
  async function raw(path: string, url: string) {
    const file = join(data, 'raw', 'broker', path);
    if (existsSync(file)) return readFile(file);
    const response = await fetcher(url, {
      headers: { ...headers, Authorization: `Bearer ${access}` },
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Stockbit HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    fetched++;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: 'wx' });
    return bytes;
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
    )`);
    const parquet = join(data, 'parquet', 'brokers');
    if (existsSync(parquet))
      await db.run(
        `INSERT INTO brokers SELECT * FROM read_parquet(${literal(join(parquet, '*.parquet'))})`,
      );
    const present = new Set(
      (await query("SELECT DISTINCT ticker || '/' || date::VARCHAR AS pair FROM brokers")).map(
        (row) => row.pair,
      ),
    );
    const entries: unknown = JSON.parse(await readFile(feed, 'utf8'));
    if (!Array.isArray(entries)) throw new Error('Invalid broker feed');
    const years = new Set<string>();
    const tickers = new Set<string>();
    const failures: string[] = [];
    for (const entry of entries) {
      if (
        !isObject(entry) ||
        typeof entry.ticker !== 'string' ||
        !/^[A-Z0-9-]+$/.test(entry.ticker) ||
        typeof entry.date !== 'string' ||
        date(entry.date) !== entry.date
      )
        throw new Error('Invalid broker target');
      const { ticker, date: day } = entry;
      const pair = `${ticker}/${day}`;
      tickers.add(ticker);
      if (present.has(pair)) continue;
      present.add(pair);
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
        const parsed: unknown = JSON.parse(
          new TextDecoder().decode(await raw(`${day}/${ticker}.json`, url.href)),
        );
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
        const sides = [
          { side: 'buy', source: summary.brokers_buy },
          { side: 'sell', source: summary.brokers_sell },
        ];
        const rows = sides.flatMap(({ side, source }) => {
          const prefix = side === 'buy' ? 'b' : 's';
          return source.map((row: unknown) => {
            if (!isObject(row)) throw new Error(`Invalid broker row: ${pair}`);
            return [
              dateValue(Date.parse(day) / 86400000),
              ticker,
              side,
              field(row, 'netbs_broker_code'),
              field(row, 'type'),
              number(row, `${prefix}lotv`),
              number(row, `${prefix}val`),
              number(row, `netbs_${side}_avg_price`),
              number(row, 'freq'),
            ];
          });
        });
        await append(rows);
        years.add(day.slice(0, 4));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${pair}: ${message}`);
        if (message === 'Stockbit HTTP 401') break;
      }
    }
    for (const year of years) {
      const file = join(parquet, `${year}.parquet`);
      await mkdir(dirname(file), { recursive: true });
      await db.run(`COPY (SELECT * FROM brokers WHERE year(date) = ${Number(year)} ORDER BY ALL)
        TO ${literal(file + '.tmp')} (FORMAT PARQUET, COMPRESSION ZSTD)`);
      await rename(file + '.tmp', file);
    }
    for (const ticker of tickers) {
      const rows = await output(`SELECT date,
        coalesce(list(struct_pack(broker := broker, investor_type := investor_type,
          shares := shares, value := value, avg_price := avg_price, freq := freq) ORDER BY broker)
          FILTER (WHERE side = 'buy'), []) buy,
        coalesce(list(struct_pack(broker := broker, investor_type := investor_type,
          shares := shares, value := value, avg_price := avg_price, freq := freq) ORDER BY broker)
          FILTER (WHERE side = 'sell'), []) sell
        FROM brokers WHERE ticker = ${literal(ticker)}
          AND date >= current_date - INTERVAL '90 days'
        GROUP BY date ORDER BY date DESC`);
      if (!rows.length) continue;
      await mkdir(join(out, 'broker'), { recursive: true });
      await writeFile(join(out, 'broker', `${ticker}.json`), `[${rows.join(',')}]\n`);
    }
    if (failures.length) throw new Error(failures.join('\n'));
    return { fetched };
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((s) => s !== '--'),
    options: {
      data: { type: 'string' },
      feed: { type: 'string' },
      token: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (!values.data || !values.feed || !values.token || !values.out)
    throw new Error(
      'Usage: brokers -- --data <dir> --feed <file> --token <file> --out <private dir>',
    );
  process.stdout.write(
    `${JSON.stringify(await brokers({ data: resolve(values.data), feed: resolve(values.feed), token: resolve(values.token), out: resolve(values.out) }))}\n`,
  );
}
