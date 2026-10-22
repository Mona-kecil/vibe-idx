/// <reference types="node" />
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { dateValue, DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBValue } from '@duckdb/node-api';
import { parsePrices } from '../web/convex/lib/prices';
import { parseIndices } from '../web/convex/lib/indices';
import { parseIssuers } from '../web/convex/lib/issuers';
import { parseFivePct } from '../web/convex/lib/fivePct';
import { idxUrl, parseOwnershipList } from '../web/convex/lib/ownershipList';
import { date } from '../web/convex/lib/rows';
import { analytics, health, market, schema, stockTable, tickers } from './sql';

const tables = ['prices', 'indices', 'five_pct', 'issuers'] as const;
type Table = (typeof tables)[number];
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const dayValue = (s: string) => dateValue(Date.parse(s) / 86400000);

export async function ingest({
  data,
  out,
  since,
  today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }),
  fetcher = fetch,
}: {
  data: string;
  out: string;
  since?: string;
  today?: string;
  fetcher?: typeof fetch;
}) {
  date(today);
  if (since) date(since);
  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  let fetched = 0;
  let requests = 0;
  const query = async (sql: string) => (await db.runAndReadAll(sql)).getRowObjectsJson();
  const present = async (table: Table) =>
    new Set(
      (await query(`SELECT DISTINCT date::VARCHAR date FROM ${table}`)).map((r) => {
        if (typeof r.date !== 'string') throw new Error('Expected ledger date');
        return r.date;
      }),
    );
  async function download(url: string) {
    const response = await fetcher(idxUrl(url), {
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`IDX HTTP ${response.status}: ${url}`);
    requests++;
    return new Uint8Array(await response.arrayBuffer());
  }
  async function raw(path: string, url: string) {
    const file = join(data, 'raw', path);
    if (existsSync(file)) return readFile(file);
    const bytes = await download(url);
    fetched++;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: 'wx' });
    return bytes;
  }
  async function append(table: Table | 'incoming_five', rows: DuckDBValue[][]) {
    const appender = await db.createAppender(table);
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
  async function save(table: Table, years: Set<string>) {
    for (const year of years) {
      const file = join(
        data,
        'parquet',
        table === 'issuers' ? 'issuers.parquet' : `${table}/${year}.parquet`,
      );
      await mkdir(dirname(file), { recursive: true });
      await db.run(`COPY (SELECT * FROM ${table} ${table === 'issuers' ? '' : `WHERE year(date) = ${Number(year)}`}
        ORDER BY ALL) TO ${literal(file + '.tmp')} (FORMAT PARQUET, COMPRESSION ZSTD)`);
      await rename(file + '.tmp', file);
    }
  }
  const json = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));
  async function output(sql: string) {
    return (await query(`SELECT to_json(r)::VARCHAR AS json FROM (${sql}) r`)).map((r) => {
      if (typeof r.json !== 'string') throw new Error('Expected JSON from DuckDB');
      return r.json;
    });
  }
  try {
    await db.run(schema);
    for (const table of tables) {
      const path = join(data, 'parquet', table === 'issuers' ? 'issuers.parquet' : table);
      if (existsSync(path))
        await db.run(
          `INSERT INTO ${table} SELECT * FROM read_parquet(${literal(table === 'issuers' ? path : join(path, '*.parquet'))})`,
        );
    }
    if (!(await present('issuers')).has(today)) {
      const issuerBytes = await raw(
        `issuers/${today}.json`,
        '/primary/ListedCompany/GetCompanyProfiles?emitenType=s&start=0&length=9999',
      );
      const issuers = parseIssuers(json(issuerBytes), Date.now());
      await db.run('DELETE FROM issuers');
      await append(
        'issuers',
        issuers.map((r) => [
          dayValue(today),
          r.ticker,
          r.name,
          r.board,
          r.sector ?? null,
          r.subSector ?? null,
          r.industry ?? null,
          r.subIndustry ?? null,
        ]),
      );
      await save('issuers', new Set([today.slice(0, 4)]));
    }
    const names = new Map(
      (await query('SELECT ticker, name FROM issuers')).map((r) => {
        if (typeof r.ticker !== 'string' || typeof r.name !== 'string')
          throw new Error('Expected issuer name');
        return [r.ticker, r.name];
      }),
    );
    for (const table of ['prices', 'indices'] as const) {
      const dates = await present(table);
      const years = new Set<string>();
      const first = since ?? [...dates].sort((a, b) => b.localeCompare(a))[0] ?? '2026-01-01';
      for (
        const d = new Date(first);
        d.toISOString().slice(0, 10) <= today;
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        const day = d.toISOString().slice(0, 10);
        if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || dates.has(day)) continue;
        const bytes = await raw(
          `${table}/${day}.json`,
          `/primary/TradingSummary/${table === 'prices' ? 'GetStockSummary' : 'GetIndexSummary'}?date=${day.replaceAll('-', '')}&start=0&length=${table === 'prices' ? 9999 : 50}`,
        );
        if (table === 'prices') {
          const rows = parsePrices(json(bytes));
          if (rows.some((r) => r.date !== day))
            throw new Error(`Stock summary date mismatch: ${day}`);
          if (!rows.length) continue;
          await append(
            table,
            rows.map((r) => [
              dayValue(r.date),
              r.ticker,
              r.close,
              r.previous,
              r.open,
              r.high,
              r.low,
              BigInt(r.volume),
              r.value,
              BigInt(r.frequency),
              BigInt(r.foreignBuy),
              BigInt(r.foreignSell),
              BigInt(r.listedShares),
              names.get(r.ticker) ?? r.ticker,
            ]),
          );
        } else {
          const rows = parseIndices(json(bytes));
          if (rows.some((r) => r.date !== day))
            throw new Error(`Index summary date mismatch: ${day}`);
          if (!rows.length) continue;
          await append(
            table,
            rows.map((r) => [
              dayValue(r.date),
              r.code,
              r.close,
              r.previous ?? null,
              r.open ?? null,
              r.high ?? null,
              r.low ?? null,
              r.change ?? null,
              r.volume ?? null,
              r.value ?? null,
              r.frequency ?? null,
            ]),
          );
        }
        years.add(day.slice(0, 4));
      }
      await save(table, years);
    }
    {
      const dates = await present('five_pct');
      const years = new Set<string>();
      const first = since ?? [...dates].sort((a, b) => b.localeCompare(a))[0] ?? '2026-05-29';
      for (let year = Number(first.slice(0, 4)); year <= Number(today.slice(0, 4)); year++) {
        const files = parseOwnershipList(
          json(
            await download(
              `/primary/list/id/perusahaan-tercatat/data-kepemilikan-saham/?year=${year}&lang=id&start=0&length=9999`,
            ),
          ),
        );
        for (const file of files) {
          if (
            file.source !== 'fivePct' ||
            file.date < first ||
            file.date > today ||
            dates.has(file.date)
          )
            continue;
          const parsed = parseFivePct(await raw(`five-pct/${file.date}.xlsx`, file.url));
          if (parsed.asOf !== file.date)
            throw new Error(`Ownership date mismatch: ${file.date} vs ${parsed.asOf}`);
          const rows = parsed.groups.flatMap((g) =>
            g.accounts.map((a) => [
              dayValue(parsed.asOf),
              g.holding.ticker,
              g.holding.investorName,
              JSON.stringify([a.holderName, a.accountName]),
              a.holderName,
              a.currentShares,
              a.previousShares,
              g.holding.combinedShares,
              g.previousCombined,
              g.previousPercent,
              g.holding.percent,
              dayValue(parsed.previousDate),
            ]),
          );
          await db.run('DELETE FROM incoming_five');
          await append('incoming_five', rows);
          await db.run(`INSERT INTO five_pct
            SELECT date, ticker, investor, account, any_value(holder_name),
              sum(shares), sum(previous_shares), max(combined_shares), max(previous_combined),
              max(pct_before), max(pct_after), max(previous_date)
            FROM incoming_five GROUP BY date, ticker, investor, account`);
          dates.add(parsed.asOf);
          years.add(parsed.asOf.slice(0, 4));
        }
      }
      await save('five_pct', years);
    }
    await db.run(analytics);
    await mkdir(join(out, 'ticker'), { recursive: true });
    await writeFile(
      join(out, 'feed.json'),
      `[${(await output('SELECT * FROM feed ORDER BY kind, ticker')).join(',')}]\n`,
    );
    await writeFile(join(out, 'market.json'), `${(await output(market))[0]}\n`);
    await writeFile(join(out, 'tickers.json'), `[${(await output(stockTable)).join(',')}]\n`);
    await writeFile(join(out, 'health.json'), `${(await output(health))[0]}\n`);
    for (const row of await output(tickers)) {
      const parsed: unknown = JSON.parse(row);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('ticker' in parsed) ||
        typeof parsed.ticker !== 'string' ||
        !/^[A-Z0-9-]+$/.test(parsed.ticker)
      )
        throw new Error('Invalid output ticker');
      await writeFile(join(out, 'ticker', `${parsed.ticker}.json`), `${row}\n`);
    }
    const counts = Object.fromEntries(
      await Promise.all(
        tables.map(async (table) => [
          table,
          (await query(`SELECT count(*)::INTEGER n FROM ${table}`))[0]?.n,
        ]),
      ),
    );
    return { fetched, requests, counts };
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((s) => s !== '--'),
    options: { data: { type: 'string' }, out: { type: 'string' }, since: { type: 'string' } },
  });
  if (!values.data || !values.out)
    throw new Error('Usage: ingest -- --data <dir> --out <dir> [--since YYYY-MM-DD]');
  process.stdout.write(
    `${JSON.stringify(await ingest({ data: resolve(values.data), out: resolve(values.out), since: values.since }))}\n`,
  );
}
