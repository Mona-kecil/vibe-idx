import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { z } from 'zod';
import { expect, it } from 'vite-plus/test';
import { ingest } from './ingest';
import { parseReport } from './reports';
import { tickerSchema } from '../web/src/data';

const research = new URL('../../docs/prototypes/workspace/research/', import.meta.url);
const keys = z.record(z.string(), z.unknown());
const snapshots = z.object({
  snapshots: z.array(
    z.object({
      asOf: z.string(),
      sourceUrl: z.url(),
      sidCount: z.number(),
      reportedFreeFloatPct: z.number(),
      totalShares: z.number(),
      reportedFreeFloatShares: z.number(),
    }),
  ),
});
const types = z.object({
  snapshots: z.array(
    z.object({
      ticker: z.string(),
      asOf: z.string(),
      categories: z.array(z.object({ label: z.string(), shares: z.number().nullable() })),
    }),
  ),
});
const flags = z.record(
  z.string(),
  z.array(
    z.object({
      investor: z.string(),
      asOf: z.string(),
      controller: z.boolean().nullable(),
      controllerAffiliate: z.boolean().nullable(),
      page: z.number(),
    }),
  ),
);

it('keeps corrected monthly snapshots, KSEI cells and blank relationships through archive replay and Parquet reload', async () => {
  const registry = keys.parse(
    JSON.parse(await readFile(new URL('registry-source.json', research), 'utf8')),
  );
  const investorTypes = types.parse(
    JSON.parse(await readFile(new URL('investor-types-source.json', research), 'utf8')),
  );
  const affiliations = flags.parse(
    JSON.parse(await readFile(new URL('affiliation-source.json', research), 'utf8')),
  );
  const root = await mkdtemp(join(tmpdir(), 'registry-monthly-'));
  const data = join(root, 'data'),
    out = join(root, 'out');
  const replies: {
    pengumuman: {
      Id2: string;
      Kode_Emiten: string;
      JudulPengumuman: string;
      TglPengumuman: string;
    };
    attachments: { OriginalFilename: string; FullSavePath: string; IsAttachment: boolean }[];
  }[] = [];
  const expected = new Map<string, ReturnType<typeof tickerSchema.parse>['registry_history']>();
  try {
    await mkdir(join(data, 'raw/reports'), { recursive: true });
    for (const ticker of ['SINI', 'BRPT', 'TPIA', 'BREN']) {
      const history = snapshots.parse(registry[ticker]).snapshots;
      for (const row of history) {
        const bytes = await readFile(
          new URL(`./fixtures/${ticker}-${row.asOf.slice(0, 7)}-main.pdf`, import.meta.url),
        );
        const result = await parseReport({ bytes, ticker, kind: 'registry' });
        expect(result.kind).toBe('parsed');
        if (result.kind !== 'parsed' || result.report.kind !== 'registry')
          throw new Error('Expected registry');
        const report = result.report;
        expect(result.gaps).toEqual([]);
        expect(report).toMatchObject({
          date: row.asOf,
          sid_count: row.sidCount,
          free_float_pct: row.reportedFreeFloatPct,
          total_shares: row.totalShares,
          free_float_shares: row.reportedFreeFloatShares,
        });
        expect(report.investor_types.map(({ label, shares }) => ({ label, shares }))).toEqual(
          investorTypes.snapshots.find((s) => s.ticker === ticker && s.asOf === row.asOf)
            ?.categories,
        );
        for (const holder of affiliations[ticker]?.filter((h) => h.asOf === row.asOf) ?? []) {
          expect(report.holders.find((h) => h.investor === holder.investor)).toMatchObject({
            controller: holder.controller,
            controller_affiliate: holder.controllerAffiliate,
            page: holder.page,
          });
        }
        expected.set(ticker, [...(expected.get(ticker) ?? []), { ...report, url: row.sourceUrl }]);
        const hash = createHash('sha256').update(row.sourceUrl).digest('hex');
        await writeFile(join(data, `raw/reports/${hash}.pdf`), bytes);
        replies.push({
          pengumuman: {
            Id2: `${ticker}/${row.asOf}`,
            Kode_Emiten: ticker,
            JudulPengumuman: 'Laporan Bulanan Registrasi Pemegang Efek',
            TglPengumuman:
              row.asOf.slice(0, 7) === '2026-05' ? '2026-06-10T12:00:00' : '2026-07-09T12:00:00',
          },
          attachments: [
            { OriginalFilename: 'main.pdf', FullSavePath: row.sourceUrl, IsAttachment: false },
          ],
        });
      }
    }
    // An older correction arrives after the selected revision. It must not replace June.
    const latest = replies.find((r) => r.pengumuman.Id2 === 'TPIA/2026-06-30');
    if (!latest) throw new Error('Missing correction fixture');
    replies.unshift({
      ...latest,
      pengumuman: { ...latest.pengumuman, Id2: 'TPIA/older', TglPengumuman: '2026-07-08T12:00:00' },
    });
    let requests = 0;
    const fetcher: typeof fetch = async (input) => {
      requests++;
      const url = new URL(input instanceof Request ? input.url : input);
      expect(url.pathname).toContain('GetAnnouncement');
      return Response.json({ ResultCount: replies.length, Replies: replies });
    };
    const options = {
      data,
      out,
      since: '2026-06-01',
      until: '2026-07-31',
      today: '2026-10-24',
      registryOnly: true,
      fetcher,
      limit: 4,
    };
    const first = await ingest(options);
    expect(first.processed).toBe(4);
    expect(first.remaining).toBe(5);
    const second = await ingest(options);
    expect(second.processed).toBe(4);
    const third = await ingest(options);
    expect(third.processed).toBe(1);
    expect(third.remaining).toBe(0);
    expect(requests).toBe(1);
    expect(third.counts.registry).toBe(8);
    expect(third.counts.registry_investors).toBe(312);
    const offline: typeof fetch = () => {
      throw new Error('Archive replay fetched IDX');
    };
    expect((await ingest({ ...options, fetcher: offline })).processed).toBe(0);
    for (const [ticker, history] of expected) {
      const actual = tickerSchema.parse(
        JSON.parse(await readFile(join(out, `ticker/${ticker}.json`), 'utf8')),
      );
      expect(actual.registry_history.map((r) => r.date)).toEqual(['2026-05-31', '2026-06-30']);
      expect(actual.registry_history).toEqual(
        history
          .map(({ investor_types, holders, ...r }) => ({
            ...r,
            investor_types: investor_types
              .slice()
              .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'variant' })),
            holders: holders
              .slice()
              .sort((a, b) => (a.investor < b.investor ? -1 : a.investor > b.investor ? 1 : 0)),
          }))
          .map((r) => tickerSchema.shape.registry_history.parse([r])[0]),
      );
    }
    // Simulate a parser upgrade and a legacy report-per-file registry ledger.
    const instance = await DuckDBInstance.create(':memory:');
    const db = await instance.connect();
    try {
      const file = join(data, 'parquet/disclosures/2026.parquet');
      await db.run(
        `CREATE TABLE old AS SELECT * EXCLUDE(registry_parser_version) FROM read_parquet('${file}')`,
      );
      await rm(file);
      await db.run(`COPY old TO '${file}' (FORMAT PARQUET)`);
      const register = join(data, 'parquet/registry/2026.parquet');
      await db.run(`CREATE TABLE legacy AS SELECT * EXCLUDE(free_float_shares) FROM read_parquet('${register}')
        UNION ALL SELECT date, 'TPIA/older', ticker, 1, total_shares, 1, url
        FROM read_parquet('${register}') WHERE ticker = 'TPIA' AND month(date) = 6`);
      await rm(register);
      await db.run(`COPY legacy TO '${register}' (FORMAT PARQUET)`);
    } finally {
      db.closeSync();
      instance.closeSync();
    }
    const replay = await ingest({
      ...options,
      reparseRegistry: true,
      fetcher: offline,
      limit: 100,
    });
    expect(replay.processed).toBe(9);
    expect(replay.counts.registry).toBe(8);
    expect(replay.report_gaps).toEqual([]);
    expect((await ingest({ ...options, reparseRegistry: true, fetcher: offline })).processed).toBe(
      0,
    );
    if (process.env.REGISTRY_PREVIEW_OUT) {
      const { cp } = await import('node:fs/promises');
      await cp(out, process.env.REGISTRY_PREVIEW_OUT, { recursive: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
