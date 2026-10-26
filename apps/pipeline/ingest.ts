import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
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
import { labelAttachments, orderAttachments, parseAnnouncements, parseReport } from './reports';
import { registryParserVersion } from './registry';
import { analytics, health, market, marketSummary, schema, stockTable, tickers } from './sql';

const archivedDisclosure = z.object({
  id: z.string(),
  ticker: z.string().nullable(),
  title: z.string(),
  published_at: z.string(),
  url: z.url(),
  kind: z.enum(['registry', 'insider', 'other']),
  attachments: z.array(
    z.object({ name: z.string(), url: z.url(), label: z.string().nullable().default(null) }),
  ),
  reports: z.array(z.object({ name: z.string(), url: z.url(), isAttachment: z.boolean() })),
});
const tables = [
  'prices',
  'indices',
  'five_pct',
  'one_pct',
  'ownership_files',
  'disclosures',
  'insiders',
  'registry',
  'registry_investors',
  'registry_holders',
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
  until,
  registryOnly = false,
  reparseRegistry = false,
  limit = 100,
  attachmentLabelLimit = 200,
  today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }),
  fetcher = fetch,
}: {
  data: string;
  out: string;
  since?: string;
  until?: string;
  registryOnly?: boolean;
  reparseRegistry?: boolean;
  limit?: number;
  attachmentLabelLimit?: number;
  today?: string;
  fetcher?: typeof fetch;
}) {
  date(today);
  if (since) date(since);
  if (until) date(until);
  if (until && (!registryOnly || until > today || (since && since > until)))
    throw new Error('Registry date range must end on or before today and after since');
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('limit must be a positive integer');
  if (!Number.isSafeInteger(attachmentLabelLimit) || attachmentLabelLimit < 0)
    throw new Error('attachment-label-limit must be a nonnegative integer');
  if (reparseRegistry && !registryOnly) throw new Error('Reparse requires --registry-only');
  let processed = 0;
  let remaining = 0;
  let labelsBackfilled = 0;
  let labelsRemaining = 0;
  let lastRequest = 0;
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
  async function download(url: string, timeout = 60000) {
    if (registryOnly) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, lastRequest + 1000 - Date.now())),
      );
      lastRequest = Date.now();
    }
    const response = await fetcher(idxUrl(url), {
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
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
  async function raw(path: string, url: string, timeout = 60000) {
    const file = join(data, 'raw', path);
    if (existsSync(file)) {
      const bytes = await readFile(file);
      const emptySummary =
        (path.startsWith('prices/') && !parsePrices(json(bytes)).length) ||
        (path.startsWith('indices/') && !parseIndices(json(bytes)).length);
      if (!emptySummary) return bytes;
    }
    const bytes = await download(url, timeout);
    await archive(path, bytes);
    return bytes;
  }
  async function attachmentLabels(
    d: Pick<z.infer<typeof archivedDisclosure>, 'attachments' | 'url' | 'ticker'>,
  ) {
    const attachments = orderAttachments(d.attachments, d.url);
    if (!attachments.some((a) => a.url !== d.url && /_lamp\d+\.[^.]+$/i.test(a.name)))
      return { attachments, gaps: [] };
    try {
      return {
        attachments: await labelAttachments({
          bytes: await raw(`reports/${hash(d.url)}.pdf`, d.url, 10000),
          attachments,
          cover: d.url,
          ticker: d.ticker,
        }),
        gaps: [],
      };
    } catch (error) {
      return {
        attachments,
        gaps: [
          {
            url: d.url,
            reason: `Attachment labels: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
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
      if (existsSync(path)) {
        const source = `read_parquet(${literal(table === 'issuers' ? path : join(path, '*.parquet'))}, union_by_name=true)`;
        if (table === 'registry') {
          const columns = await query(`DESCRIBE SELECT * FROM ${source}`);
          const hasFloatShares = columns.some((c) => c.column_name === 'free_float_shares');
          await db.run(`INSERT INTO registry SELECT r.date, r.id, r.ticker, r.free_float_pct,
            r.total_shares, r.sid_count, r.url, ${hasFloatShares ? 'r.free_float_shares' : 'NULL'}
            FROM ${source} r LEFT JOIN disclosures d USING(id)
            QUALIFY row_number() OVER (PARTITION BY r.date, r.ticker
              ORDER BY d.published_at DESC NULLS LAST, r.id DESC, r.url DESC) = 1`);
        } else await db.run(`INSERT INTO ${table} BY NAME SELECT * FROM ${source}`);
      }
    }
    // IDX encodes TRUE as an Excel boolean; older parsers stored its ticker as '1'.
    for (const table of ['five_pct', 'one_pct'] as const) {
      const years = new Set<string>();
      for (const r of await query(
        `SELECT DISTINCT year(date)::VARCHAR partition_year FROM ${table} WHERE ticker = '1'`,
      )) {
        if (typeof r.partition_year !== 'string') throw new Error('Expected ownership ledger year');
        years.add(r.partition_year);
      }
      if (!years.size) continue;
      await db.run(`INSERT INTO ${table}
        SELECT * REPLACE ('TRUE' AS ticker) FROM ${table} WHERE ticker = '1'
        ON CONFLICT DO NOTHING;
        DELETE FROM ${table} WHERE ticker = '1'`);
      await save(table, years);
    }
    if (!registryOnly && !(await present('issuers')).has(today)) {
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
      if (registryOnly) continue;
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
    if (!registryOnly) {
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
        (
          await query(
            'SELECT id, date::VARCHAR date, source_json, kind, registry_parser_version FROM disclosures',
          )
        ).map((r) => {
          if (
            typeof r.id !== 'string' ||
            typeof r.date !== 'string' ||
            typeof r.source_json !== 'string'
          )
            throw new Error('Expected disclosure ledger identity');
          const d = archivedDisclosure.parse(JSON.parse(r.source_json));
          return [
            r.id,
            {
              date: r.date,
              source: JSON.stringify({ ...d, attachments: orderAttachments(d.attachments, d.url) }),
              kind: r.kind,
              version: r.registry_parser_version,
            },
          ];
        }),
      );
      const latest = [...known.values()]
        .map((r) => r.date)
        .sort()
        .at(-1);
      const first = since ?? (latest ? shiftDay(latest, -2) : shiftDay(today, -89));
      const through = until ?? today;
      const disclosures: ReturnType<typeof parseAnnouncements>['disclosures'] = [];
      const ids = new Set<string>();
      let offset = 0;
      let pageNumber = 0;
      let total: number | undefined;
      if (reparseRegistry) {
        for (const record of known.values()) {
          if (record.kind !== 'registry' || record.date < first || record.date > through) continue;
          // Revalidate stored announcement metadata through the same boundary as live discovery.
          const source: unknown = JSON.parse(record.source);
          const archived = archivedDisclosure.parse(source);
          disclosures.push(archived);
        }
      }
      while (!reparseRegistry && (total === undefined || offset < total)) {
        const params = new URLSearchParams({
          kodeEmiten: '',
          emitenType: '*',
          indexFrom: String(pageNumber),
          pageSize: '100',
          dateFrom: first.replaceAll('-', ''),
          dateTo: through.replaceAll('-', ''),
          lang: 'id',
          keyword: registryOnly ? 'Laporan Bulanan Registrasi Pemegang Efek' : '',
        });
        const url = `/primary/ListedCompany/GetAnnouncement?${params}`;
        const bytes = registryOnly
          ? await raw(`registry-pages/${first}-${through}/${pageNumber}.json`, url)
          : await download(url);
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
        registry_investors: new Set<string>(),
        registry_holders: new Set<string>(),
      };
      try {
        for (const d of disclosures.sort(
          (a, b) => a.published_at.localeCompare(b.published_at) || a.id.localeCompare(b.id),
        )) {
          const source = JSON.stringify(d);
          if (registryOnly && d.kind !== 'registry') continue;
          if (
            known.get(d.id)?.source === source &&
            (d.kind !== 'registry' || known.get(d.id)?.version === registryParserVersion)
          )
            continue;
          if (registryOnly && processed >= limit) {
            remaining++;
            continue;
          }
          processed++;
          const labeled = await attachmentLabels(d);
          const gaps: { url: string; reason: string }[] = labeled.gaps;
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
            if (table === 'registry') {
              for (const child of ['registry_investors', 'registry_holders'] as const) {
                for (const year of years.registry) years[child].add(year);
                await db.run(`DELETE FROM ${child} WHERE (date, ticker) IN
                (SELECT date, ticker FROM registry WHERE id = ${literal(d.id)})`);
              }
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
              JSON.stringify(labeled.attachments),
              source,
              JSON.stringify(gaps),
              d.kind === 'registry' ? registryParserVersion : null,
              1,
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
            else {
              const identity = `ticker = ${literal(d.ticker ?? '')} AND date = DATE ${literal(r.date)}`;
              const newer = await query(`SELECT r.id FROM registry r JOIN disclosures d USING(id)
              WHERE r.ticker = ${literal(d.ticker ?? '')} AND r.date = DATE ${literal(r.date)} AND (d.published_at, r.id) > (${literal(d.published_at)}, ${literal(d.id)})`);
              if (newer.length) continue;
              for (const table of ['registry', 'registry_investors', 'registry_holders'] as const) {
                await db.run(`DELETE FROM ${table} WHERE ${identity}`);
                years[table].add(r.date.slice(0, 4));
              }
              await append('registry', [
                [
                  dayValue(r.date),
                  d.id,
                  d.ticker,
                  r.free_float_pct,
                  r.total_shares,
                  r.sid_count,
                  url,
                  r.free_float_shares,
                ],
              ]);
              await append(
                'registry_investors',
                r.investor_types.map((v) => [
                  dayValue(r.date),
                  d.ticker,
                  v.label,
                  v.shares,
                  v.page,
                ]),
              );
              await append(
                'registry_holders',
                r.holders.map((v) => [
                  dayValue(r.date),
                  d.ticker,
                  v.investor,
                  v.pct,
                  v.controller,
                  v.controller_affiliate,
                  v.page,
                ]),
              );
            }
            years[r.kind === 'insider' ? 'insiders' : 'registry'].add(r.date.slice(0, 4));
          }
        }
        if (!registryOnly) {
          const pending = await query(`SELECT id, year(date)::VARCHAR partition_year, ticker, url,
            attachments::VARCHAR attachments, report_gaps::VARCHAR gaps FROM disclosures
            WHERE attachment_labels_version IS NULL ORDER BY published_at DESC, id DESC`);
          for (const row of pending) {
            const d = z
              .object({
                id: z.string(),
                partition_year: z.string(),
                ticker: z.string().nullable(),
                url: z.url(),
                attachments: z
                  .string()
                  .transform((value) =>
                    archivedDisclosure.shape.attachments.parse(JSON.parse(value)),
                  ),
                gaps: z
                  .string()
                  .transform((value) =>
                    z
                      .array(z.object({ url: z.string(), reason: z.string() }))
                      .parse(JSON.parse(value)),
                  ),
              })
              .parse(row);
            const attachments = orderAttachments(d.attachments, d.url);
            const needsCover = attachments.some(
              (a) => a.url !== d.url && /_lamp\d+\.[^.]+$/i.test(a.name),
            );
            const attempt = !needsCover || labelsBackfilled < attachmentLabelLimit;
            const labeled = attempt
              ? await attachmentLabels({ ...d, attachments })
              : { attachments, gaps: [] };
            await db.run(`UPDATE disclosures SET attachments = ${literal(JSON.stringify(labeled.attachments))},
              attachment_labels_version = ${attempt ? '1' : 'NULL'},
              report_gaps = ${literal(JSON.stringify([...d.gaps, ...labeled.gaps]))}
              WHERE id = ${literal(d.id)}`);
            years.disclosures.add(d.partition_year);
            if (needsCover) {
              if (attempt) labelsBackfilled++;
              else labelsRemaining++;
            }
          }
        }
      } finally {
        for (const table of [
          'insiders',
          'registry',
          'registry_investors',
          'registry_holders',
          'disclosures',
        ] as const)
          await save(table, years[table]);
      }
    }
    await db.run(analytics);
    await mkdir(join(out, 'ticker'), { recursive: true });
    await writeFile(
      join(out, 'feed.json'),
      `[${(await output('SELECT * FROM feed ORDER BY kind, ticker')).join(',')}]\n`,
    );
    await writeFile(join(out, 'market-summary.json'), `${(await output(marketSummary))[0]}\n`);
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
    return {
      fetched,
      requests,
      counts,
      report_gaps,
      processed,
      remaining,
      attachment_labels: { backfilled: labelsBackfilled, remaining: labelsRemaining },
    };
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
      out: { type: 'string' },
      since: { type: 'string' },
      until: { type: 'string' },
      'registry-only': { type: 'boolean' },
      'reparse-registry': { type: 'boolean' },
      limit: { type: 'string' },
      'attachment-label-limit': { type: 'string' },
    },
  });
  if (!values.data || !values.out)
    throw new Error(
      'Usage: ingest -- --data <dir> --out <dir> [--since YYYY-MM-DD] [--attachment-label-limit 200] [--registry-only --until YYYY-MM-DD --limit 100 --reparse-registry]',
    );
  process.stdout.write(
    `${JSON.stringify(
      await ingest({
        data: resolve(values.data),
        out: resolve(values.out),
        since: values.since,
        until: values.until,
        registryOnly: values['registry-only'],
        reparseRegistry: values['reparse-registry'],
        limit: values.limit ? Number(values.limit) : undefined,
        attachmentLabelLimit:
          values['attachment-label-limit'] !== undefined
            ? Number(values['attachment-label-limit'])
            : undefined,
      }),
    )}\n`,
  );
}
