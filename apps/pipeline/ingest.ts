import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { dateValue, DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBValue } from '@duckdb/node-api';
import { parsePrices } from './lib/prices';
import { parseIndices } from './lib/indices';
import { parseIssuers } from './lib/issuers';
import { parseFivePct } from './lib/fivePct';
import { parseOnePct } from './lib/onePct';
import { idxUrl, parseOwnershipList } from './lib/ownershipList';
import { date } from './lib/rows';
import { parseAnnouncements, parseReport } from './reports';
import { analytics, health, market, schema, stockTable, tickers } from './sql';

const tables = [
  'prices',
  'indices',
  'five_pct',
  'one_pct',
  'ownership_files',
  'disclosures',
  'insiders',
  'registry',
  'issuers',
] as const;
type Table = (typeof tables)[number];
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const dayValue = (s: string) => dateValue(Date.parse(s) / 86400000);
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const shiftDay = (day: string, offset: number) =>
  new Date(Date.parse(day) + offset * 86400000).toISOString().slice(0, 10);

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
  async function archive(path: string, bytes: Uint8Array) {
    const file = join(data, 'raw', path);
    if (existsSync(file)) return;
    fetched++;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: 'wx' });
  }
  async function raw(path: string, url: string) {
    const file = join(data, 'raw', path);
    if (existsSync(file)) return readFile(file);
    const bytes = await download(url);
    await archive(path, bytes);
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
      const monthlyDates = await present('one_pct');
      const monthlyYears = new Set<string>();
      const fileYears = new Set<string>();
      const monthlyFirst =
        since ?? [...monthlyDates].sort((a, b) => b.localeCompare(a))[0] ?? '2026-02-01';
      const knownFiles = new Set(
        (await query('SELECT url FROM ownership_files')).map((r) => r.url),
      );
      for (
        let year = Math.min(Number(first.slice(0, 4)), Number(monthlyFirst.slice(0, 4)));
        year <= Number(today.slice(0, 4));
        year++
      ) {
        const bytes = await download(
          `/primary/list/id/perusahaan-tercatat/data-kepemilikan-saham/?year=${year}&lang=id&start=0&length=9999`,
        );
        await archive(`ownership-list/${year}-${hash(bytes)}.json`, bytes);
        const files = parseOwnershipList(json(bytes));
        for (const file of files) {
          if (file.date > today || knownFiles.has(file.url)) continue;
          if (file.source === 'onePct') {
            if (file.date < monthlyFirst) continue;
            const rows = parseOnePct(await raw(`one-pct/${hash(file.url)}.xlsx`, file.url));
            if (!rows.length) throw new Error(`Empty 1% ownership file: ${file.url}`);
            const incomingDates = new Set(rows.map((r) => r.asOf));
            if (incomingDates.size !== 1) throw new Error(`Mixed 1% snapshot dates: ${file.url}`);
            const incoming = rows.filter(
              (r) => r.asOf >= monthlyFirst && r.asOf <= today && !monthlyDates.has(r.asOf),
            );
            await append(
              'one_pct',
              incoming.map((r) => [
                dayValue(r.asOf),
                r.ticker,
                r.investorName,
                r.seq,
                r.issuerName,
                r.total,
                r.percent,
                r.classification ?? null,
                r.localForeign ?? null,
                r.nationality ?? null,
                r.domicile ?? null,
                r.scripless ?? null,
                r.scrip ?? null,
                file.url,
              ]),
            );
            for (const r of incoming) {
              monthlyDates.add(r.asOf);
              monthlyYears.add(r.asOf.slice(0, 4));
            }
            for (const asOf of incomingDates) {
              if (asOf < monthlyFirst || asOf > today) continue;
              await append('ownership_files', [[dayValue(asOf), file.source, file.url]]);
              fileYears.add(asOf.slice(0, 4));
              knownFiles.add(file.url);
            }
            continue;
          }
          if (file.date < first) continue;
          const parsed = parseFivePct(await raw(`five-pct/${hash(file.url)}.xlsx`, file.url));
          if (parsed.asOf < first || parsed.asOf > today) continue;
          await append('ownership_files', [[dayValue(parsed.asOf), file.source, file.url]]);
          fileYears.add(parsed.asOf.slice(0, 4));
          knownFiles.add(file.url);
          if (dates.has(parsed.asOf)) continue;
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
      await save('one_pct', monthlyYears);
      await save('ownership_files', fileYears);
    }
    {
      const known = new Map(
        (await query('SELECT id, date::VARCHAR date, source_json FROM disclosures')).map((r) => {
          if (
            typeof r.id !== 'string' ||
            typeof r.date !== 'string' ||
            typeof r.source_json !== 'string'
          )
            throw new Error('Expected disclosure ledger identity');
          return [r.id, { date: r.date, source: r.source_json }];
        }),
      );
      const latest = [...known.values()]
        .map((r) => r.date)
        .sort()
        .at(-1);
      const first = since ?? (latest ? shiftDay(latest, -2) : shiftDay(today, -89));
      const disclosures: ReturnType<typeof parseAnnouncements>['disclosures'] = [];
      const ids = new Set<string>();
      let offset = 0;
      let pageNumber = 0;
      let total: number | undefined;
      while (total === undefined || offset < total) {
        const params = new URLSearchParams({
          kodeEmiten: '',
          emitenType: '*',
          indexFrom: String(pageNumber),
          pageSize: '100',
          dateFrom: first.replaceAll('-', ''),
          dateTo: today.replaceAll('-', ''),
          lang: 'id',
          keyword: '',
        });
        const url = `/primary/ListedCompany/GetAnnouncement?${params}`;
        const bytes = await download(url);
        await archive(`disclosures/${first}-${today}/${offset}-${hash(bytes)}.json`, bytes);
        const page = parseAnnouncements(json(bytes));
        if (total !== undefined && total !== page.total)
          throw new Error('Announcement count changed during pagination; retry the run');
        total = page.total;
        if (
          (!page.disclosures.length && offset < total) ||
          offset + page.disclosures.length > total
        )
          throw new Error(`Incomplete announcement page at ${offset} of ${total}`);
        for (const d of page.disclosures) {
          if (ids.has(d.id)) throw new Error(`Repeated announcement during pagination: ${d.id}`);
          ids.add(d.id);
          disclosures.push(d);
        }
        offset += page.disclosures.length;
        pageNumber++;
      }
      const years = {
        disclosures: new Set<string>(),
        insiders: new Set<string>(),
        registry: new Set<string>(),
      };
      for (const d of disclosures) {
        const source = JSON.stringify(d);
        if (known.get(d.id)?.source === source) continue;
        const gaps: { url: string; reason: string }[] = [];
        const reports: {
          url: string;
          report: Extract<Awaited<ReturnType<typeof parseReport>>, { kind: 'parsed' }>['report'];
        }[] = [];
        if (d.kind !== 'other' && d.ticker) {
          if (!d.reports.length)
            gaps.push({ url: d.url, reason: 'No supported report PDF attachment' });
          for (const attachment of d.reports) {
            const result = await parseReport({
              bytes: await raw(`reports/${hash(attachment.url)}.pdf`, attachment.url),
              ticker: d.ticker,
              kind: d.kind,
            });
            if (result.kind === 'unsupported')
              gaps.push({ url: attachment.url, reason: result.reason });
            else {
              reports.push({ url: attachment.url, report: result.report });
              gaps.push(...result.gaps.map((reason) => ({ url: attachment.url, reason })));
            }
          }
        }
        for (const table of ['disclosures', 'insiders', 'registry'] as const) {
          for (const r of await query(
            `SELECT DISTINCT year(date)::VARCHAR AS partition_year FROM ${table} WHERE id = ${literal(d.id)}`,
          )) {
            if (typeof r.partition_year !== 'string')
              throw new Error('Expected report ledger year');
            years[table].add(r.partition_year);
          }
          await db.run(`DELETE FROM ${table} WHERE id = ${literal(d.id)}`);
        }
        await append('disclosures', [
          [
            dayValue(date(d.published_at)),
            d.id,
            d.ticker,
            d.title,
            d.published_at,
            d.url,
            d.kind,
            JSON.stringify(d.attachments),
            source,
            JSON.stringify(gaps),
          ],
        ]);
        years.disclosures.add(d.published_at.slice(0, 4));
        for (const { report: r, url } of reports) {
          if (r.kind === 'insider')
            await append('insiders', [
              [
                dayValue(r.date),
                d.id,
                d.ticker,
                r.reporter,
                r.shares_before,
                r.shares_after,
                r.net_shares,
                url,
              ],
            ]);
          else
            await append('registry', [
              [
                dayValue(r.date),
                d.id,
                d.ticker,
                r.free_float_pct,
                r.total_shares,
                r.sid_count,
                url,
              ],
            ]);
          years[r.kind === 'insider' ? 'insiders' : 'registry'].add(r.date.slice(0, 4));
        }
      }
      for (const table of ['disclosures', 'insiders', 'registry'] as const)
        await save(table, years[table]);
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
    const report_gaps = await query(`SELECT d.id, g.value->>'url' url, g.value->>'reason' reason
      FROM disclosures d, json_each(d.report_gaps) g ORDER BY d.id, url, reason`);
    return { fetched, requests, counts, report_gaps };
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
