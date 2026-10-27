import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vite-plus/test';
import { ingest } from './ingest';
import { analytics, schema, tickers } from './sql';

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url));

const insiderExamples = [
  {
    ticker: 'BJTM',
    file: 'LK-08062026-4607-00.pdf',
    reporter: 'R ARIEF WICAKSONO',
    before: 2718600,
    after: 3718600,
  },
  {
    ticker: 'TPIA',
    file: 'LK-08062026-5332-00.pdf',
    reporter: 'FRANSISKUS RULY ARYAWAN',
    before: 400212,
    after: 1010212,
  },
  {
    ticker: 'BUKK',
    file: 'LK-08062026-6195-00.pdf',
    reporter: 'NADIA ACHMAD',
    before: 185613823,
    after: 388475003,
  },
  {
    ticker: 'BEEF',
    file: 'LK-08062026-9030-00.pdf',
    reporter: 'PT ESTIKA TATA TIARA TBK',
    before: 10712200,
    after: 11969900,
  },
];
const registryExamples = [
  {
    ticker: 'BBCA',
    file: 'BBCA_1_20260608_BBCA_Laporan Bulanan Registrasi Pemegang Efek_Perubahan Struktur Pemegang Saham_32098358.pdf',
    pct: 42.46,
    total: 122042299500,
    sid: 767370,
  },
  {
    ticker: 'IMPC',
    file: 'IMPC_1_20260610_IMPC_Laporan Bulanan Registrasi Pemegang Efek_Perubahan Struktur Pemegang Saham_32099872.pdf',
    pct: 23.85,
    total: 54907000000,
    sid: 19685,
  },
  {
    ticker: 'SINI',
    file: 'SINI_1_20260605_SINI_Laporan Bulanan Registrasi Pemegang Efek_Perubahan Struktur Pemegang Saham_32097662.pdf',
    pct: 25.07,
    total: 481000000,
    sid: 5742,
  },
  {
    ticker: 'VKTR',
    file: 'VKTR_1_20260609_VKTR_Laporan Bulanan Registrasi Pemegang Efek_Perubahan Struktur Pemegang Saham_32099316.pdf',
    pct: 61.19,
    total: 43750000000,
    sid: 28971,
  },
];
function announcement({
  ticker,
  id,
  title,
  path,
  name,
}: {
  ticker: string;
  id: string;
  title: string;
  path?: string;
  name?: string;
}) {
  return {
    pengumuman: {
      Id2: id,
      Kode_Emiten: `${ticker}   `,
      JudulPengumuman: title,
      TglPengumuman: '2026-10-21T10:00:00',
    },
    attachments: path
      ? [
          {
            OriginalFilename: name ?? 'report.pdf',
            FullSavePath: `https://www.idx.co.id${path}`,
            IsAttachment: false,
          },
        ]
      : [],
  };
}

function network({ monthly = false, reports = false } = {}) {
  const urls: string[] = [];
  const pdfs = new Map([
    ...insiderExamples.map((r): [string, string] => [
      `/StaticData/From_KSEI/${r.file}`,
      `idx-insider/${r.file}`,
    ]),
    ...registryExamples.map((r): [string, string] => [
      `/StaticData/From_EREP/${r.ticker}.pdf`,
      `laporan-efek-samples-specific/${r.file}`,
    ]),
    ['/StaticData/From_EREP/unsupported.pdf', 'idx-insider/LK-08062026-4607-00.pdf'],
  ]);
  const disclosures = reports
    ? [
        ...insiderExamples.map((r) =>
          announcement({
            ticker: r.ticker,
            id: `insider/${r.ticker}`,
            title: 'Laporan Kepemilikan atau Setiap Perubahan Kepemilikan Saham Perusahaan Terbuka',
            path: `/StaticData/From_KSEI/${r.file}`,
            name: r.file,
          }),
        ),
        ...registryExamples.map((r) =>
          announcement({
            ticker: r.ticker,
            id: `registry/${r.ticker}`,
            title: 'Laporan Bulanan Registrasi Pemegang Efek',
            path: `/StaticData/From_EREP/${r.ticker}.pdf`,
          }),
        ),
        announcement({
          ticker: 'AADI',
          id: 'registry/unsupported',
          title: 'Laporan Bulanan Registrasi Pemegang Efek',
          path: '/StaticData/From_EREP/unsupported.pdf',
        }),
        announcement({ ticker: 'AADI', id: 'other/no-attachment', title: 'Keterbukaan Informasi' }),
      ]
    : [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const pdf = pdfs.get(url.pathname);
    urls.push(url.href);
    expect(url.hostname).toBe('www.idx.id');
    let name: string;
    if (url.pathname.includes('GetStockSummary') || url.pathname.includes('GetIndexSummary')) {
      if (url.searchParams.get('date') !== '20261021')
        return Response.json({ recordsTotal: 0, data: [] });
      name = url.pathname.includes('GetStockSummary')
        ? 'stock-summary-idxid.json'
        : 'index-summary-idxid.json';
      const marketFixtureForOwnershipDay = (await fixture(name))
        .toString()
        .replaceAll('2026-10-20', '2026-10-21');
      return new Response(marketFixtureForOwnershipDay);
    }
    if (url.pathname.includes('GetCompanyProfiles')) name = 'company-profiles.json';
    else if (url.pathname.includes('GetAnnouncement')) {
      const start = Number(url.searchParams.get('indexFrom')) * 2;
      const from = url.searchParams.get('dateFrom') ?? '';
      const to = url.searchParams.get('dateTo') ?? '';
      const rows = disclosures.filter((d) => {
        const published = d.pengumuman.TglPengumuman.slice(0, 10).replaceAll('-', '');
        return published >= from && published <= to;
      });
      return Response.json({ ResultCount: rows.length, Replies: rows.slice(start, start + 2) });
    } else if (pdf) {
      return new Response(
        new Uint8Array(await readFile(new URL(`../../samples/${pdf}`, import.meta.url))),
      );
    } else if (url.pathname.includes('data-kepemilikan-saham')) {
      return Response.json({
        items: [
          ...['19', '21'].map((day) => ({
            Description: '',
            Prospectus: `/Media/2026-10-${day}-lima-persen.xlsx`,
            ListingDate: `2026-10-${Number(day) + 1}`,
          })),
          ...(monthly
            ? [
                {
                  Description: '',
                  Prospectus: '/Media/2026-02-satu-persen.xlsx',
                  ListingDate: '2026-03-02',
                },
                {
                  Description: '',
                  Prospectus: '/Media/2026-09-satu-persen.xlsx',
                  ListingDate: '2026-10-01',
                },
              ]
            : []),
        ],
      });
    } else if (url.pathname.endsWith('-lima-persen.xlsx')) {
      name = `ownership-5pct-${url.pathname.slice('/Media/'.length, -'-lima-persen.xlsx'.length)}.xlsx`;
    } else if (url.pathname.endsWith('-satu-persen.xlsx')) {
      name = `ownership-1pct-${url.pathname.slice('/Media/'.length, -'-satu-persen.xlsx'.length)}.xlsx`;
    } else throw new Error(`Unexpected network call: ${url.href}`);
    return new Response(new Uint8Array(await fixture(name)));
  };
  return { urls, fetcher, disclosures };
}

describe('batch pipeline', () => {
  it.each([
    {
      month: 'January',
      since: '2026-01-01',
      until: '2026-01-29',
      today: '2026-01-30',
      metadata: './fixtures/ownership-legacy-2026-01.json',
      pdf: './fixtures/ownership-5pct-2026-01-29.pdf',
      investor: 'ADARO STRATEGIC INVESTMENTS PT',
    },
    {
      month: 'June',
      since: '2026-06-01',
      until: '2026-06-05',
      today: '2026-06-08',
      metadata: '../../samples/idx-5pct/latest-response.json',
      pdf: '../../samples/idx-5pct/20260608_Semua Emiten Saham_Pengumuman Bursa_32098373_lamp1.pdf',
      investor: 'ADARO STRATEGIC INVESTMENTS',
    },
  ])(
    'backfills $month ownership PDF cells across pages instead of ignoring the legacy source',
    async (source) => {
      const root = await mkdtemp(join(tmpdir(), 'idx-legacy-ownership-'));
      const page = JSON.parse(await readFile(new URL(source.metadata, import.meta.url), 'utf8'));
      const legacy = page.Replies[0];
      const attachment = legacy.attachments.find((a: { IsAttachment: boolean }) => a.IsAttachment);
      const urls: string[] = [];
      let includeXlsx = false;
      const workbookUrl =
        'https://www.idx.id/Media/dqvnijtx/peng-2026-06-05-00005-lima-persen.xlsx';
      const options = {
        data: join(root, 'data'),
        out: join(root, 'out'),
        since: source.since,
        until: source.until,
        today: source.today,
        ownershipOnly: true,
        fetcher: async (input: string | URL | Request) => {
          const url = new URL(input instanceof Request ? input.url : input);
          urls.push(url.href);
          if (url.pathname.includes('data-kepemilikan-saham'))
            return Response.json({
              items: includeXlsx
                ? [
                    {
                      Description: 'Pemegang Saham di Atas 5%',
                      Prospectus: workbookUrl,
                      ListingDate: '2026-06-05',
                    },
                  ]
                : [],
            });
          if (url.href === workbookUrl)
            return new Response(new Uint8Array(await fixture('ownership-5pct-2026-06-05.xlsx')));
          if (url.pathname.includes('GetAnnouncement'))
            return Response.json({ ResultCount: 1, Replies: [legacy] });
          if (url.pathname === new URL(attachment.FullSavePath).pathname)
            return new Response(
              new Uint8Array(await readFile(new URL(source.pdf, import.meta.url))),
            );
          throw new Error(`Unexpected request: ${url.href}`);
        },
      };
      try {
        const result = await ingest(options);
        expect(result.counts.five_pct).toBeGreaterThan(0);
        const ticker = JSON.parse(await readFile(join(options.out, 'ticker/AADI.json'), 'utf8'));
        expect(ticker.holders).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ investor: source.investor, shares: 3200142830, pct: 41.1 }),
          ]),
        );
        expect(result.ownership?.five_pct_dates).toEqual([source.until]);
        expect(result.counts.prices).toBe(0);
        expect(result.counts.disclosures).toBe(0);
        if (source.month === 'January') {
          const alto = JSON.parse(await readFile(join(options.out, 'ticker/ALTO.json'), 'utf8'));
          expect(alto.holders).toContainEqual({
            investor: 'PT TRIMEGAH SEKURITAS INDONESIA TBK',
            shares: 210832443,
            pct: 9.62,
          });
          const dcii = JSON.parse(await readFile(join(options.out, 'ticker/DCII.json'), 'utf8'));
          expect(dcii.holders).toContainEqual({
            investor: 'ANTHONI SALIM',
            shares: 265033461,
            pct: 11.12,
          });
        }
        const beforeReplay = urls.length;
        const replay = await ingest(options);
        expect(replay.counts.five_pct).toBe(result.counts.five_pct);
        expect(replay.processed).toBe(0);
        expect(urls.slice(beforeReplay).some((url) => url.endsWith('.pdf'))).toBe(false);
        expect(
          urls.some((url) => /GetCompanyProfiles|GetStockSummary|GetIndexSummary/.test(url)),
        ).toBe(false);
        if (source.month === 'June') {
          includeXlsx = true;
          const data = join(root, 'overlap/data');
          await ingest({ ...options, data, out: join(root, 'overlap/out') });
          const instance = await DuckDBInstance.create(':memory:');
          const db = await instance.connect();
          try {
            const rows = (
              await db.runAndReadAll(`SELECT shares FROM read_parquet('${join(data, 'parquet/five_pct/2026.parquet')}')
              WHERE ticker = 'BEEF' AND investor = 'DIMAS WIBOWO'
                AND holder_name = 'PT. STOCKBIT SEKURITAS DIGITAL'`)
            ).getRowObjectsJson();
            // These sources disagree: the PDF says 134,322, the XLSX cell says 134.322.
            expect(rows).toEqual([{ shares: 134.322 }]);
          } finally {
            db.closeSync();
            instance.closeSync();
          }
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it('keeps a late 1% snapshot from a primary XLSX attachment and ignores ticker-specific filings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idx-legacy-onepct-'));
    const page = JSON.parse((await fixture('ownership-legacy-2026-01.json')).toString());
    const bulk = {
      ...page.Replies[0],
      pengumuman: {
        ...page.Replies[0].pengumuman,
        Id2: 'legacy-onepct',
        JudulPengumuman: 'Pemegang Saham di atas 1% (KSEI)',
        TglPengumuman: '2026-03-02T12:00:00',
      },
      attachments: [
        {
          OriginalFilename: 'ownership.xlsx',
          FullSavePath: '/StaticData/ownership.xlsx',
          IsAttachment: false,
        },
      ],
    };
    const company = {
      ...bulk,
      pengumuman: { ...bulk.pengumuman, Id2: 'company-onepct', Kode_Emiten: 'AADI' },
      attachments: [
        {
          OriginalFilename: 'ignore.xlsx',
          FullSavePath: '/StaticData/ignore.xlsx',
          IsAttachment: false,
        },
      ],
    };
    const legacyPdf = {
      ...bulk,
      pengumuman: { ...bulk.pengumuman, Id2: 'legacy-onepct-pdf' },
      attachments: [
        {
          OriginalFilename: 'announcement.pdf',
          FullSavePath: '/StaticData/announcement.pdf',
          IsAttachment: false,
        },
        {
          OriginalFilename: 'ownership.pdf',
          FullSavePath: '/StaticData/ownership-1pct.pdf',
          IsAttachment: true,
        },
      ],
    };
    const options = {
      data: join(root, 'data'),
      out: join(root, 'out'),
      ownershipOnly: true,
      since: '2026-02-01',
      until: '2026-02-28',
      today: '2026-03-02',
      fetcher: async (input: string | URL | Request) => {
        const u = new URL(input instanceof Request ? input.url : input);
        if (u.pathname.includes('data-kepemilikan-saham')) return Response.json({ items: [] });
        if (u.pathname.includes('GetAnnouncement')) {
          const page = Number(u.searchParams.get('indexFrom'));
          return Response.json({ ResultCount: 3, Replies: [[bulk], [company], [legacyPdf]][page] });
        }
        if (u.pathname === '/StaticData/ownership.xlsx')
          return new Response(new Uint8Array(await fixture('ownership-1pct-2026-02.xlsx')));
        throw new Error(`Unexpected ownership request: ${u.href}`);
      },
    };
    try {
      const result = await ingest(options);
      expect(result.counts.one_pct).toBe(7257);
      expect(result.ownership?.one_pct_dates).toEqual(['2026-02-27']);
      expect(result.ownership?.skipped_one_pct_pdfs).toEqual([
        'https://www.idx.id/StaticData/ownership-1pct.pdf',
      ]);
      const ticker = JSON.parse(await readFile(join(options.out, 'ticker/ICON.json'), 'utf8'));
      expect(
        ticker.one_pct.holders.filter(
          (h: { investor: string }) => h.investor === 'ISLAND REGENCY GROUP LIMITED',
        ),
      ).toEqual([
        expect.objectContaining({ shares: 42187000 }),
        expect.objectContaining({ shares: 20000000 }),
      ]);
      await expect(ingest({ ...options, registryOnly: true })).rejects.toThrow(
        'without --registry-only',
      );
      await expect(ingest({ ...options, until: '2026-03-01' })).rejects.toThrow(
        'one calendar month',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('repairs boolean tickers across Parquet years without key conflicts or replay changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idx-true-ticker-'));
    const options = {
      data: join(root, 'data'),
      out: join(root, 'out'),
      since: '2026-10-21',
      today: '2026-10-21',
      registryOnly: true,
      fetcher: network().fetcher,
    };
    try {
      const instance = await DuckDBInstance.create(':memory:');
      const db = await instance.connect();
      try {
        await db.run(schema);
        await db.run(`INSERT INTO five_pct (date, ticker, investor, account, shares,
          combined_shares, previous_combined, pct_before, pct_after, previous_date) VALUES
          ('2024-10-21', 'AADI', 'OTHER', 'a', 30, 30, 20, 2, 3, '2024-10-20'),
          ('2025-10-21', '1', 'INVESTOR', 'a', 100, 100, 90, 9, 10, '2025-10-20'),
          ('2026-10-21', '1', 'INVESTOR', 'a', 100, 100, 90, 9, 10, '2026-10-20'),
          ('2026-10-21', 'TRUE', 'INVESTOR', 'a', 110, 110, 90, 9, 11, '2026-10-20'),
          ('2026-10-21', '1', 'INVESTOR', 'b', 0, 110, 90, 9, 11, '2026-10-20');
          INSERT INTO one_pct (date, ticker, investor, seq, shares, pct) VALUES
          ('2024-09-30', 'AADI', 'OTHER', 0, 30, 3),
          ('2025-09-30', '1', 'INVESTOR', 0, 100, 10),
          ('2026-09-30', '1', 'INVESTOR', 0, 100, 10),
          ('2026-09-30', 'TRUE', 'INVESTOR', 0, 110, 11),
          ('2026-09-30', '1', 'INVESTOR', 1, 20, 2)`);
        for (const table of ['five_pct', 'one_pct']) {
          await mkdir(join(options.data, 'parquet', table), { recursive: true });
          for (const year of [2024, 2025, 2026])
            await db.run(`COPY (SELECT * FROM ${table} WHERE year(date) = ${year})
              TO '${join(options.data, 'parquet', table, `${year}.parquet`)}' (FORMAT PARQUET)`);
        }
      } finally {
        db.closeSync();
        instance.closeSync();
      }
      const paths = ['five_pct', 'one_pct'].flatMap((table) =>
        [2024, 2025, 2026].map((year) => join(options.data, 'parquet', table, `${year}.parquet`)),
      );
      const before = await Promise.all(paths.map((path) => readFile(path)));
      const first = await ingest(options);
      expect(first.counts).toMatchObject({ five_pct: 4, one_pct: 4 });
      const ledger = await DuckDBInstance.create(':memory:');
      const saved = await ledger.connect();
      try {
        for (const [table, extraShares] of [
          ['five_pct', 0],
          ['one_pct', 20],
        ] as const) {
          const rows =
            await saved.runAndReadAll(`SELECT year(date)::INTEGER partition_year, ticker, shares
            FROM read_parquet('${join(options.data, 'parquet', table, '*.parquet')}')
            ORDER BY date, shares`);
          expect(rows.getRowObjectsJson()).toEqual([
            { partition_year: 2024, ticker: 'AADI', shares: 30 },
            { partition_year: 2025, ticker: 'TRUE', shares: 100 },
            { partition_year: 2026, ticker: 'TRUE', shares: extraShares },
            { partition_year: 2026, ticker: 'TRUE', shares: 110 },
          ]);
        }
      } finally {
        saved.closeSync();
        ledger.closeSync();
      }
      const published = JSON.parse(await readFile(join(options.out, 'ticker/TRUE.json'), 'utf8'));
      expect(published.holders).toEqual([{ investor: 'INVESTOR', shares: 110, pct: 11 }]);
      expect(published.one_pct.holders).toMatchObject([
        { investor: 'INVESTOR', shares: 110, pct: 11 },
        { investor: 'INVESTOR', shares: 20, pct: 2 },
      ]);
      expect(JSON.parse(await readFile(join(options.out, 'feed.json'), 'utf8'))).toEqual([
        expect.objectContaining({ ticker: 'TRUE', kind: 'five_pct_change' }),
      ]);
      expect(await readdir(join(options.out, 'ticker'))).toEqual(['AADI.json', 'TRUE.json']);
      const repaired = await Promise.all(paths.map((path) => readFile(path)));
      expect(repaired[0]).toEqual(before[0]);
      expect(repaired[3]).toEqual(before[3]);
      const restored = { ...options, data: join(root, 'restored'), out: join(root, 'replayed') };
      await cp(join(options.data, 'parquet'), join(restored.data, 'parquet'), { recursive: true });
      const replay = await ingest(restored);
      expect(replay.counts).toEqual(first.counts);
      expect(JSON.parse(await readFile(join(restored.out, 'ticker/TRUE.json'), 'utf8'))).toEqual(
        published,
      );
      expect(await readdir(join(restored.out, 'ticker'))).toEqual(['AADI.json', 'TRUE.json']);
      expect(
        await Promise.all(
          paths.map((path) => readFile(join(restored.data, relative(options.data, path)))),
        ),
      ).toEqual(repaired);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not publish spelling-only shareholder exits and keeps the latest holder names', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const db = await instance.connect();
    try {
      await db.run(schema);
      await db.run(`INSERT INTO prices (date, ticker) VALUES ('2026-10-23', 'SINI');
        INSERT INTO five_pct (date, ticker, investor, account, combined_shares,
          previous_combined, pct_before, pct_after, previous_date) VALUES
        ('2026-10-21', 'SINI', 'PT. KREASI JASA PERSADA', 'a', 94940000, 94940000, 7.9, 7.9, '2026-10-20'),
        ('2026-10-21', 'SINI', 'PT. PETROSEA TBK', 'a', 239105000, 239105000, 19.88, 19.88, '2026-10-20'),
        ('2026-10-21', 'SINI', 'BATUBARA DEVELOPMENT PTE. LTD.', 'a', 74530000, 74530000, 6.2, 6.2, '2026-10-20'),
        ('2026-10-21', 'SINI', 'PT. PERSADA JASA KREASI', 'a', 70000000, 70000000, 5.82, 5.82, '2026-10-20'),
        ('2026-10-23', 'SINI', 'KREASI  JASA PERSADA PT', 'a', 94940000, NULL, NULL, 7.9, '2026-10-21'),
        ('2026-10-23', 'SINI', 'PT PETROSEA TBK', 'a', 239105000, NULL, NULL, 19.88, '2026-10-21'),
        ('2026-10-23', 'SINI', 'Batubara Development Limited', 'a', 74530000, NULL, NULL, 6.2, '2026-10-21'),
        ('2026-10-23', 'SINI', 'PERSADA JASA KREASI PT', 'a', 70000000, NULL, NULL, 5.82, '2026-10-21');`);
      await db.run(analytics);
      const published = (await db.runAndReadAll(tickers)).getRowObjectsJson();
      expect(published).toMatchObject([
        {
          ticker: 'SINI',
          changes: [],
          holders: expect.arrayContaining([
            { investor: 'KREASI  JASA PERSADA PT', shares: 94940000, pct: 7.9 },
            { investor: 'PT PETROSEA TBK', shares: 239105000, pct: 19.88 },
            { investor: 'Batubara Development Limited', shares: 74530000, pct: 6.2 },
            { investor: 'PERSADA JASA KREASI PT', shares: 70000000, pct: 5.82 },
          ]),
        },
      ]);
      expect((await db.runAndReadAll('SELECT * FROM feed')).getRowObjectsJson()).toEqual([]);
    } finally {
      db.closeSync();
      instance.closeSync();
    }
  });

  it('keeps older keyed share changes, marks unknown exits, and publishes entrants from zero', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const db = await instance.connect();
    try {
      await db.run(schema);
      await db.run(`INSERT INTO prices (date, ticker) VALUES
        ('2026-01-02', 'SINI'), ('2026-10-23', 'SINI');
        INSERT INTO five_pct (date, ticker, investor, account, combined_shares,
          previous_combined, pct_before, pct_after, previous_date) VALUES
        ('2026-01-02', 'SINI', 'PT. KREASI JASA PERSADA', 'a', 94940000, 94940000, 7.9, 7.9, '2026-01-01'),
        ('2026-01-02', 'SINI', 'EVER GRACE INTERNATIONAL TRADING LIMITED', 'a', 90000000, 90000000, 7.48, 7.48, '2026-01-01'),
        ('2026-01-05', 'SINI', 'KREASI JASA PERSADA PT', 'a', 100000000, 0, 0, 8.32, '2026-01-02'),
        ('2026-01-05', 'SINI', 'KREASI JASA PERSADA PT', 'b', 100000000, 0, 0, 8.32, '2026-01-02'),
        ('2026-10-23', 'SINI', 'PT KREASI JASA PERSADA', 'a', 100000000, 100000000, 8.32, 8.32, '2026-01-05'),
        ('2026-10-23', 'SINI', 'PT DELI INDONESIA RAYA', 'a', 90000000, 30000000, 2.49, 7.48, '2026-01-05');`);
      await db.run(analytics);
      const published = (await db.runAndReadAll(tickers)).getRowObjectsJson();
      expect(published).toMatchObject([
        {
          ticker: 'SINI',
          changes: [
            {
              date: '2026-10-23',
              investor: 'PT DELI INDONESIA RAYA',
              shares_before: 0,
              pct_before: 0,
              shares_after: 90000000,
              pct_after: 7.48,
              net_shares: 90000000,
              exited: false,
            },
            {
              date: '2026-01-05',
              investor: 'EVER GRACE INTERNATIONAL TRADING LIMITED',
              shares_before: 90000000,
              pct_before: 7.48,
              shares_after: null,
              pct_after: null,
              net_shares: null,
              exited: true,
            },
            {
              date: '2026-01-05',
              investor: 'PT KREASI JASA PERSADA',
              shares_before: 94940000,
              pct_before: 7.9,
              shares_after: 100000000,
              pct_after: 8.32,
              net_shares: 5060000,
              exited: false,
            },
          ],
        },
      ]);
      const feed = (await db.runAndReadAll('SELECT * FROM feed'))
        .getRowObjectsJson()
        .map(({ numbers, ...row }) => {
          if (typeof numbers !== 'string') throw new Error('Expected JSON from DuckDB');
          return { ...row, numbers: JSON.parse(numbers) };
        });
      expect(feed).toMatchObject([
        {
          ticker: 'SINI',
          date: '2026-10-23',
          kind: 'five_pct_change',
          numbers: {
            investor: 'PT DELI INDONESIA RAYA',
            shares_before: 0,
            pct_before: 0,
            shares_after: 90000000,
            net_shares: 90000000,
            exited: false,
          },
        },
      ]);
    } finally {
      db.closeSync();
      instance.closeSync();
    }
  });

  it('recovers stock and index rows after empty summaries were cached in persistent data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idx-empty-summary-'));
    const net = network();
    const options = {
      data: join(root, 'data'),
      out: join(root, 'out'),
      since: '2026-10-20',
      today: '2026-10-21',
    };
    try {
      const first = await ingest({
        ...options,
        fetcher: async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : input);
          if (url.pathname.includes('TradingSummary')) {
            if (url.searchParams.get('date') === '20261021')
              return Response.json({ recordsTotal: 0, data: [] });
            return new Response(
              new Uint8Array(
                await fixture(
                  url.pathname.includes('GetStockSummary')
                    ? 'stock-summary-idxid.json'
                    : 'index-summary-idxid.json',
                ),
              ),
            );
          }
          return net.fetcher(input, init);
        },
      });
      expect(first.counts).toMatchObject({ prices: 963, indices: 45 });
      const rawPaths = ['prices', 'indices'].map((table) =>
        join(options.data, 'raw', table, '2026-10-21.json'),
      );
      const archived = await Promise.all(rawPaths.map((path) => readFile(path)));
      expect(archived.map((bytes) => JSON.parse(bytes.toString()))).toEqual([
        { recordsTotal: 0, data: [] },
        { recordsTotal: 0, data: [] },
      ]);
      net.urls.length = 0;
      const recovered = await ingest({ ...options, fetcher: net.fetcher });
      expect(recovered.counts).toMatchObject({ prices: 1926, indices: 90 });
      expect(
        net.urls
          .filter((url) => url.includes('TradingSummary'))
          .map((url) => new URL(url).searchParams.get('date')),
      ).toEqual(['20261021', '20261021']);
      expect(await Promise.all(rawPaths.map((path) => readFile(path)))).toEqual(archived);
      const instance = await DuckDBInstance.create(':memory:');
      const db = await instance.connect();
      try {
        for (const [table, n] of [
          ['prices', 963],
          ['indices', 45],
        ] as const) {
          const rows = (
            await db.runAndReadAll(`SELECT date::VARCHAR date, count(*)::INTEGER n
              FROM read_parquet('${join(options.data, 'parquet', table, '2026.parquet')}')
              GROUP BY date ORDER BY date`)
          ).getRowObjectsJson();
          expect(rows).toEqual([
            { date: '2026-10-20', n },
            { date: '2026-10-21', n },
          ]);
        }
      } finally {
        db.closeSync();
        instance.closeSync();
      }
      net.urls.length = 0;
      const replay = await ingest({ ...options, fetcher: net.fetcher });
      expect(replay.counts).toEqual(recovered.counts);
      expect(net.urls.filter((url) => url.includes('TradingSummary'))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('preserves source dates, duplicate holders, paginated disclosures, and SID counts with negative deltas', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idx-fixture-'));
    try {
      const net = network({ monthly: true, reports: true });
      const text =
        'Perihal X Laporan TEST 1 Laporan Bulanan Registrasi Pemegang Efek akhir bulan September - 2026 ' +
        '% Saham Free Float 42,00 41,00 Pernyataan ' +
        'Jumlah Pemegang Saham Nasabah Pemilik SID Bulan Sebelumnya Bulan Sekarang Perubahan 1.000 900 -100';
      const stream = `BT /F1 10 Tf 1 0 0 1 10 800 Tm (${text}) Tj ET
BT /F1 10 Tf 1 0 0 1 34 600 Tm (Jumlah Pemegang Saham Nasabah Pemilik SID) Tj ET
BT /F1 10 Tf 1 0 0 1 81 560 Tm (Bulan Sebelumnya) Tj ET
BT /F1 10 Tf 1 0 0 1 259 560 Tm (Bulan Sekarang) Tj ET
BT /F1 10 Tf 1 0 0 1 445 560 Tm (Perubahan) Tj ET
BT /F1 10 Tf 1 0 0 1 172 530 Tm (1.000) Tj ET
BT /F1 10 Tf 1 0 0 1 335 530 Tm (900) Tj ET
BT /F1 10 Tf 1 0 0 1 529 530 Tm (-100) Tj ET`;
      const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2000 1000] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      ];
      let pdf = '%PDF-1.4\n';
      const offsets: number[] = [];
      for (const [i, object] of objects.entries()) {
        offsets.push(pdf.length);
        pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
      }
      const xref = pdf.length;
      pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      net.disclosures.push(
        announcement({
          ticker: 'TEST',
          id: 'registry/negative-sid',
          title: 'Laporan Bulanan Registrasi Pemegang Efek',
          path: '/StaticData/From_EREP/negative-sid.pdf',
        }),
      );
      const registryFetcher: typeof fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname === '/StaticData/From_EREP/negative-sid.pdf') {
          net.urls.push(url.href);
          return new Response(new TextEncoder().encode(pdf));
        }
        return net.fetcher(input, init);
      };
      await ingest({
        data: join(root, 'data'),
        out: join(root, 'out'),
        since: '2026-02-01',
        today: '2026-03-02',
        fetcher: registryFetcher,
      });
      const icon = JSON.parse(await readFile(join(root, 'out/ticker/ICON.json'), 'utf8'));
      expect(icon.one_pct).toMatchObject({ date: '2026-02-27' });
      expect(icon.one_pct.holders).toContainEqual(
        expect.objectContaining({
          investor: 'ISLAND REGENCY GROUP LIMITED',
          shares: 42187000,
          pct: 3.87,
        }),
      );
      expect(icon.one_pct.holders).toContainEqual(
        expect.objectContaining({
          investor: 'ISLAND REGENCY GROUP LIMITED',
          shares: 20000000,
          pct: 1.84,
        }),
      );
      net.urls.length = 0;
      const result = await ingest({
        data: join(root, 'data'),
        out: join(root, 'out'),
        since: '2026-02-01',
        today: '2026-10-22',
        fetcher: registryFetcher,
      });
      expect(result.counts).toMatchObject({
        prices: 963,
        indices: 45,
        issuers: 962,
        one_pct: 14411,
        disclosures: 11,
        insiders: 4,
        registry: 5,
      });
      const negativeSid = JSON.parse(await readFile(join(root, 'out/ticker/TEST.json'), 'utf8'));
      expect(negativeSid.registry_history.at(-1)).toMatchObject({
        date: '2026-09-30',
        free_float_pct: null,
        total_shares: null,
        sid_count: 900,
        url: 'https://www.idx.id/StaticData/From_EREP/negative-sid.pdf',
      });
      for (const field of [
        'total shares',
        'free float percentage',
        'free float shares',
        'investor types',
        'holder flags',
      ]) {
        expect(result.report_gaps).toContainEqual({
          id: 'registry/negative-sid',
          url: negativeSid.registry_history.at(-1).url,
          reason: `Registry ${field}: unsupported or missing labeled cells`,
        });
      }
      const feed = JSON.parse(await readFile(join(root, 'out/feed.json'), 'utf8'));
      expect(feed).toContainEqual(
        expect.objectContaining({
          ticker: 'BUVA',
          kind: 'five_pct_change',
          numbers: expect.objectContaining({
            investor: 'NUSANTARA UTAMA INVESTAMA PT',
            pct_before: 59.7,
            pct_after: 64.4,
            shares_before: 15034031772,
            shares_after: 18508539715,
            net_shares: 3474507943,
          }),
        }),
      );
      expect(feed).not.toContainEqual(
        expect.objectContaining({
          ticker: 'AADI',
          kind: 'five_pct_change',
          numbers: expect.objectContaining({ investor: 'ADARO STRATEGIC INVESTMENTS' }),
        }),
      );
      const aadi = JSON.parse(await readFile(join(root, 'out/ticker/AADI.json'), 'utf8'));
      expect(aadi.prices).toHaveLength(1);
      expect(aadi.holders).toContainEqual(
        expect.objectContaining({ investor: 'ADARO STRATEGIC INVESTMENTS', shares: 3200142830 }),
      );
      expect(aadi.changes).not.toContainEqual(
        expect.objectContaining({ date: '2026-10-21', investor: 'ADARO STRATEGIC INVESTMENTS' }),
      );
      expect(aadi.one_pct).toMatchObject({
        date: '2026-09-30',
        holders: expect.arrayContaining([
          {
            investor: 'PT PERSADA CAPITAL INVESTAMA',
            shares: 119887170,
            pct: 1.54,
            classification: 'Corporate',
            local_foreign: 'L',
          },
        ]),
      });
      expect(aadi.registry_history).toEqual([]);
      expect(aadi.insiders).toEqual([]);
      expect(aadi.disclosures).toContainEqual({
        id: 'registry/unsupported',
        title: 'Laporan Bulanan Registrasi Pemegang Efek',
        published_at: '2026-10-21T10:00:00',
        kind: 'registry',
        url: 'https://www.idx.id/StaticData/From_EREP/unsupported.pdf',
        attachments: [
          {
            name: 'report.pdf',
            url: 'https://www.idx.id/StaticData/From_EREP/unsupported.pdf',
            label: null,
          },
        ],
      });
      expect(result.report_gaps).toContainEqual({
        id: 'registry/unsupported',
        url: 'https://www.idx.id/StaticData/From_EREP/unsupported.pdf',
        reason: 'Unrecognized IDX registry report header or reporting month',
      });
      for (const r of insiderExamples) {
        const ticker = JSON.parse(
          await readFile(join(root, `out/ticker/${r.ticker}.json`), 'utf8'),
        );
        expect(ticker.insiders).toEqual([
          {
            date: '2026-06-08',
            reporter: r.reporter,
            shares_before: r.before,
            shares_after: r.after,
            net_shares: r.after - r.before,
            url: `https://www.idx.id/StaticData/From_KSEI/${r.file}`,
          },
        ]);
      }
      for (const r of registryExamples) {
        const ticker = JSON.parse(
          await readFile(join(root, `out/ticker/${r.ticker}.json`), 'utf8'),
        );
        expect(ticker.registry_history.at(-1)).toMatchObject({
          date: '2026-05-31',
          free_float_pct: r.pct,
          total_shares: r.total,
          sid_count: r.sid,
          url: `https://www.idx.id/StaticData/From_EREP/${r.ticker}.pdf`,
        });
      }
      const instance = await DuckDBInstance.create(':memory:');
      const db = await instance.connect();
      try {
        const rows = (
          await db.runAndReadAll(`SELECT date::VARCHAR date, seq, shares, pct
          FROM read_parquet('${join(root, 'data/parquet/one_pct/2026.parquet')}')
          WHERE ticker = 'ICON' AND investor = 'ISLAND REGENCY GROUP LIMITED' AND date = '2026-02-27'
          ORDER BY seq`)
        ).getRowObjectsJson();
        expect(rows).toEqual([
          { date: '2026-02-27', seq: 0, shares: 42187000, pct: 3.87 },
          { date: '2026-02-27', seq: 1, shares: 20000000, pct: 1.84 },
        ]);
      } finally {
        db.closeSync();
        instance.closeSync();
      }
      expect(
        net.urls
          .filter((u) => u.includes('GetAnnouncement'))
          .map((u) => new URL(u).searchParams.get('indexFrom')),
      ).toEqual(['0', '1', '2', '3', '4', '5']);
      expect(JSON.parse(await readFile(join(root, 'out/health.json'), 'utf8'))).toMatchObject({
        prices: '2026-10-21',
        five_pct: '2026-10-21',
        one_pct: '2026-09-30',
      });
      expect(await readdir(join(root, 'data/raw/five-pct'))).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('does not duplicate rows, rewrite Parquet, or miss a same-day disclosure on replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idx-replay-'));
    const net = network({ monthly: true, reports: true });
    const options = {
      data: join(root, 'data'),
      out: join(root, 'out'),
      today: '2026-10-22',
      fetcher: net.fetcher,
    };
    try {
      const first = await ingest(options);
      const marketSummary = JSON.parse(
        await readFile(join(options.out, 'market-summary.json'), 'utf8'),
      );
      expect(marketSummary.date).toBe('2026-10-21');
      expect(marketSummary.stocks.length).toBeGreaterThan(0);
      expect(Object.keys(marketSummary.stocks[0].windows)).toEqual(['1d', '3d', '5d']);
      expect(JSON.stringify(marketSummary)).not.toContain('broker');
      expect(
        new URL(net.urls.find((u) => u.includes('GetAnnouncement')) ?? '').searchParams.get(
          'dateFrom',
        ),
      ).toBe('20260725');
      const paths = [
        'prices/2026.parquet',
        'indices/2026.parquet',
        'five_pct/2026.parquet',
        'one_pct/2026.parquet',
        'ownership_files/2026.parquet',
        'disclosures/2026.parquet',
        'insiders/2026.parquet',
        'registry/2026.parquet',
        'issuers.parquet',
      ];
      const before = await Promise.all(
        paths.map((p) => readFile(join(options.data, 'parquet', p))),
      );
      for (const source of ['five-pct', 'one-pct', 'reports'])
        await rm(join(options.data, 'raw', source), { recursive: true });
      net.urls.length = 0;
      const second = await ingest({ ...options, since: '2026-07-25' });
      expect(second.counts).toEqual(first.counts);
      expect(second.fetched).toBe(0);
      expect(
        await Promise.all(paths.map((p) => readFile(join(options.data, 'parquet', p)))),
      ).toEqual(before);
      expect(
        net.urls.every((url) =>
          /data-kepemilikan-saham|GetAnnouncement|GetStockSummary|GetIndexSummary/.test(url),
        ),
      ).toBe(true);
      expect(second.report_gaps).toEqual(first.report_gaps);
      const beforeRaw = await readdir(join(options.data, 'raw/disclosures/2026-07-25-2026-10-22'));
      expect(beforeRaw).toHaveLength(5);
      const newDisclosure = announcement({
        ticker: 'AADI',
        id: 'same-day/addition',
        title: 'Keterbukaan Informasi Tambahan',
      });
      newDisclosure.pengumuman.TglPengumuman = '2026-10-21T09:00:00';
      net.disclosures.unshift(newDisclosure);
      net.urls.length = 0;
      const third = await ingest(options);
      expect(third.counts.disclosures).toBe(11);
      expect(
        new URL(net.urls.find((u) => u.includes('GetAnnouncement')) ?? '').searchParams.get(
          'dateFrom',
        ),
      ).toBe('20261019');
      const aadi = JSON.parse(await readFile(join(options.out, 'ticker/AADI.json'), 'utf8'));
      expect(aadi.disclosures).toContainEqual(
        expect.objectContaining({
          id: 'same-day/addition',
          published_at: '2026-10-21T09:00:00',
          kind: 'other',
          attachments: [],
        }),
      );
      expect(await readdir(join(options.data, 'raw/disclosures/2026-07-25-2026-10-22'))).toEqual(
        beforeRaw,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it('rejects truncated pages and failed fetches, recovers interrupted report saves, and retains unreadable PDFs as linked disclosures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idx-source-failure-'));
    const net = network({ reports: true });
    const options = {
      data: join(root, 'data'),
      out: join(root, 'out'),
      since: '2026-10-21',
      today: '2026-10-22',
    };
    try {
      await expect(
        ingest({
          ...options,
          fetcher: async (input, init) => {
            const url = new URL(input instanceof Request ? input.url : input);
            if (
              url.pathname.includes('GetAnnouncement') &&
              url.searchParams.get('indexFrom') === '1'
            )
              return Response.json({ ResultCount: 10, Replies: [] });
            return net.fetcher(input, init);
          },
        }),
      ).rejects.toThrow('Incomplete announcement page');
      await expect(readFile(join(options.out, 'ticker/BJTM.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(
        ingest({
          ...options,
          fetcher: async (input, init) => {
            const url = new URL(input instanceof Request ? input.url : input);
            if (url.pathname.includes('From_KSEI'))
              return new Response('unavailable', { status: 502 });
            return net.fetcher(input, init);
          },
        }),
      ).rejects.toThrow('IDX HTTP 502');
      await expect(
        readFile(join(options.data, 'parquet/disclosures/2026.parquet')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        ingest({
          ...options,
          fetcher: async (input, init) => {
            const url = new URL(input instanceof Request ? input.url : input);
            if (url.pathname.endsWith('/unsupported.pdf')) {
              await mkdir(join(options.data, 'parquet/insiders/2026.parquet'), {
                recursive: true,
              });
              return new Response('%PDF-1.7\ntruncated');
            }
            return net.fetcher(input, init);
          },
        }),
      ).rejects.toMatchObject({ code: 'EISDIR' });
      const restored = { ...options, data: join(root, 'restored') };
      await cp(join(options.data, 'raw'), join(restored.data, 'raw'), { recursive: true });
      for (const entry of await readdir(join(options.data, 'parquet'), {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!entry.isFile() || !entry.name.endsWith('.parquet')) continue;
        const source = join(entry.parentPath, entry.name);
        const target = join(restored.data, relative(options.data, source));
        await mkdir(dirname(target), { recursive: true });
        await cp(source, target);
      }
      net.urls.length = 0;
      const withUnreadableReport = await ingest({ ...restored, fetcher: net.fetcher });
      expect(withUnreadableReport.counts).toMatchObject({
        disclosures: 10,
        insiders: 4,
        registry: 4,
      });
      expect(net.urls.filter((url) => /From_KSEI|From_EREP/.test(url))).toEqual([]);
      expect(withUnreadableReport.report_gaps).toContainEqual({
        id: 'registry/unsupported',
        url: 'https://www.idx.id/StaticData/From_EREP/unsupported.pdf',
        reason: 'Unreadable PDF: InvalidPDFException',
      });
      const published = JSON.parse(await readFile(join(options.out, 'ticker/AADI.json'), 'utf8'));
      expect(published.disclosures).toContainEqual(
        expect.objectContaining({ id: 'registry/unsupported' }),
      );
      expect(published.registry_history).toEqual([]);
      const recovered = await ingest({ ...restored, fetcher: net.fetcher });
      expect(recovered.counts).toMatchObject({
        disclosures: 10,
        insiders: 4,
        registry: 4,
        one_pct: 0,
      });
      const bjtm = JSON.parse(await readFile(join(options.out, 'ticker/BJTM.json'), 'utf8'));
      expect(bjtm.one_pct).toEqual({ date: null, holders: [] });
      expect(bjtm.insiders).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('parses a registry report whose cover failed to download for attachment labels', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idx-registry-label-gap-'));
    const net = network({ reports: true });
    const sini = net.disclosures.find((d) => d.pengumuman.Id2 === 'registry/SINI');
    sini?.attachments.push({
      OriginalFilename: 'SINI_lamp1.pdf',
      FullSavePath: 'https://www.idx.co.id/StaticData/From_EREP/SINI_lamp1.pdf',
      IsAttachment: true,
    });
    let coverFailures = 1;
    try {
      const result = await ingest({
        data: join(root, 'data'),
        out: join(root, 'out'),
        since: '2026-10-21',
        today: '2026-10-22',
        fetcher: async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : input);
          if (url.pathname === '/StaticData/From_EREP/SINI.pdf' && coverFailures-- > 0)
            return new Response('unavailable', { status: 502 });
          return net.fetcher(input, init);
        },
      });
      expect(result.counts).toMatchObject({ registry: 4 });
      const published = JSON.parse(await readFile(join(root, 'out/ticker/SINI.json'), 'utf8'));
      expect(published.registry_history).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

it('backfills legacy Parquet newest first within the limit without duplicates, repeat downloads, or failure starvation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'idx-labels-'));
  const net = network();
  const options = {
    data: join(root, 'data'),
    out: join(root, 'out'),
    since: '2026-10-20',
    today: '2026-10-21',
    attachmentLabelLimit: 1,
  };
  const make = (id: string, hour: number, cover = 'shared') => {
    const d = announcement({
      ticker: 'SINI',
      id,
      title: 'Penjelasan',
      path: `/covers/${cover}.pdf`,
      name: 'cover.pdf',
    });
    d.pengumuman.TglPengumuman = `2026-10-21T${String(hour).padStart(2, '0')}:00:00`;
    d.attachments = [
      {
        OriginalFilename: 'report_lamp2.pdf',
        FullSavePath: `https://www.idx.id/${id}/lamp2.pdf`,
        IsAttachment: true,
      },
      ...d.attachments,
      {
        OriginalFilename: 'report_lamp1.pdf',
        FullSavePath: `https://www.idx.id/${id}/lamp1.pdf`,
        IsAttachment: true,
      },
    ];
    for (const attachment of d.attachments)
      attachment.FullSavePath = attachment.FullSavePath.replace('www.idx.co.id', 'www.idx.id');
    return d;
  };
  const legacy = [
    make('oldest', 1),
    make('middle', 2),
    make('bad-pdf', 3, 'invalid'),
    make('fetch-failure', 4, 'missing'),
    make('newest', 5),
  ];
  const ksei = announcement({
    ticker: 'SINI',
    id: 'ksei',
    title: 'LAPORAN KEPEMILIKAN',
    path: '/covers/ksei.pdf',
    name: 'LK-report.pdf',
  });
  const fresh = make('fresh', 6, 'fresh');
  const coverCalls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.includes('GetAnnouncement'))
      return Response.json({ ResultCount: 2, Replies: [legacy[0], fresh] });
    if (url.pathname.startsWith('/covers/')) {
      coverCalls.push(url.pathname);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url.pathname === '/covers/missing.pdf') return new Response('', { status: 503 });
      if (url.pathname === '/covers/invalid.pdf') return new Response('broken PDF');
      return new Response(new Uint8Array(await fixture('SINI-2026-10-15-cover.pdf')));
    }
    return net.fetcher(input, init);
  };
  const published = async () =>
    JSON.parse(await readFile(join(options.out, 'ticker/SINI.json'), 'utf8'));
  try {
    await ingest({ ...options, fetcher: net.fetcher });
    const instance = await DuckDBInstance.create(':memory:');
    const db = await instance.connect();
    try {
      await db.run(schema);
      for (const d of [...legacy, ksei]) {
        const attachments = d.attachments.map((a) => ({
          name: a.OriginalFilename,
          url: a.FullSavePath,
        }));
        const source = {
          id: d.pengumuman.Id2,
          ticker: 'SINI',
          title: d.pengumuman.JudulPengumuman,
          published_at: d.pengumuman.TglPengumuman,
          url: d.attachments.find((a) => !a.IsAttachment)?.FullSavePath,
          kind: 'other',
          attachments,
          reports: [],
        };
        await db.run(`INSERT INTO disclosures (date, id, ticker, title, published_at, url, kind, attachments, source_json, report_gaps)
          VALUES ('2026-10-21', '${source.id}', 'SINI', '${source.title}', '${source.published_at}', '${source.url}',
          'other', '${JSON.stringify(attachments)}', '${JSON.stringify(source)}', '[]')`);
      }
      await mkdir(join(options.data, 'parquet/disclosures'), { recursive: true });
      await db.run(`COPY (SELECT * EXCLUDE(attachment_labels_version) FROM disclosures)
        TO '${join(options.data, 'parquet/disclosures/2026.parquet')}' (FORMAT PARQUET)`);
    } finally {
      db.closeSync();
      instance.closeSync();
    }
    const paused = await ingest({ ...options, attachmentLabelLimit: 0, fetcher });
    expect(paused.attachment_labels).toEqual({ backfilled: 0, remaining: 5 });
    expect(paused.processed).toBe(1);
    expect(coverCalls).toEqual(['/covers/fresh.pdf']);
    const initial = await published();
    expect(initial.disclosures).toHaveLength(7);
    expect(
      initial.disclosures
        .find((d: { id: string }) => d.id === 'fresh')
        .attachments.map((a: { label: string | null }) => a.label),
    ).toEqual([null, 'surat penyampaian penjelasan bursa', 'Penjelasan tentang Karhutla']);
    expect(
      initial.disclosures
        .find((d: { id: string }) => d.id === 'oldest')
        .attachments.map((a: { name: string; label: null }) => [a.name, a.label]),
    ).toEqual([
      ['cover.pdf', null],
      ['report_lamp1.pdf', null],
      ['report_lamp2.pdf', null],
    ]);
    for (const [id, remaining] of [
      ['newest', 4],
      ['fetch-failure', 3],
      ['bad-pdf', 2],
      ['middle', 1],
      ['oldest', 0],
    ] satisfies [string, number][]) {
      const run = await ingest({ ...options, fetcher });
      expect(run.attachment_labels).toEqual({ backfilled: 1, remaining });
      expect(run.processed).toBe(0);
      expect(run.counts.disclosures).toBe(7);
      const row = (await published()).disclosures.find((d: { id: string }) => d.id === id);
      expect(row.attachments[1].label).toBe(
        ['fetch-failure', 'bad-pdf'].includes(id) ? null : 'surat penyampaian penjelasan bursa',
      );
      if (id === 'fetch-failure')
        expect(run.report_gaps).toContainEqual(
          expect.objectContaining({ id, reason: expect.stringContaining('IDX HTTP 503') }),
        );
      if (id === 'bad-pdf')
        expect(run.report_gaps).toContainEqual(
          expect.objectContaining({ id, reason: expect.stringContaining('Attachment labels:') }),
        );
    }
    expect(coverCalls).toEqual([
      '/covers/fresh.pdf',
      '/covers/shared.pdf',
      '/covers/missing.pdf',
      '/covers/invalid.pdf',
    ]);
    const parquet = await readFile(join(options.data, 'parquet/disclosures/2026.parquet'));
    const final = await published();
    const replay = await ingest({ ...options, fetcher });
    expect(replay.attachment_labels).toEqual({ backfilled: 0, remaining: 0 });
    expect(replay.processed).toBe(0);
    expect(await published()).toEqual(final);
    expect(await readFile(join(options.data, 'parquet/disclosures/2026.parquet'))).toEqual(parquet);
    expect(coverCalls).toHaveLength(4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it('excludes small seven-day foreign inflows and five-day runs while including runs at or above three percent of traded value', async () => {
  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  try {
    await db.run(schema);
    for (const [ticker, netShares, start] of [
      ['LOW', 2, 1],
      ['EDGE', 3, 1],
      ['HIGH', 4, 1],
      ['SHORT', 4, 3],
    ] satisfies [string, number, number][]) {
      for (let day = start; day <= 7; day++)
        await db.run(`INSERT INTO prices (date, ticker, close, prev, volume, value, foreign_buy, foreign_sell)
          VALUES ('2026-10-0${day}', '${ticker}', 100, 100, 100, 10000, ${netShares}, 0)`);
    }
    await db.run(analytics);
    const result = await db.runAndReadAll(
      `SELECT ticker, (numbers->>'streak_days')::INTEGER streak_days,
       (numbers->>'net_foreign')::DOUBLE net_foreign
       FROM feed WHERE kind = 'foreign_streak' ORDER BY ticker`,
    );
    expect(result.getRowObjectsJson()).toEqual([
      {
        ticker: 'EDGE',
        streak_days: 7,
        net_foreign: 2100,
      },
      {
        ticker: 'HIGH',
        streak_days: 7,
        net_foreign: 2800,
      },
    ]);
  } finally {
    db.closeSync();
    instance.closeSync();
  }
});
