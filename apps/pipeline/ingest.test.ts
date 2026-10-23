import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vite-plus/test';
import { ingest } from './ingest';

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
    sid: 767370,
  },
  {
    ticker: 'IMPC',
    file: 'IMPC_1_20260610_IMPC_Laporan Bulanan Registrasi Pemegang Efek_Perubahan Struktur Pemegang Saham_32099872.pdf',
    pct: 23.85,
    sid: 19685,
  },
  {
    ticker: 'SINI',
    file: 'SINI_1_20260605_SINI_Laporan Bulanan Registrasi Pemegang Efek_Perubahan Struktur Pemegang Saham_32097662.pdf',
    pct: 25.07,
    sid: 5742,
  },
  {
    ticker: 'VKTR',
    file: 'VKTR_1_20260609_VKTR_Laporan Bulanan Registrasi Pemegang Efek_Perubahan Struktur Pemegang Saham_32099316.pdf',
    pct: 61.19,
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
      // The market fixtures are dated October 20; align them with the ownership regression day.
      return new Response((await fixture(name)).toString().replaceAll('2026-10-20', '2026-10-21'));
    }
    if (url.pathname.includes('GetCompanyProfiles')) name = 'company-profiles.json';
    else if (url.pathname.includes('GetAnnouncement')) {
      const start = Number(url.searchParams.get('indexFrom'));
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
  it('keeps source dates, duplicate 1% holders, paginated disclosures, and verified PDF values without losing 5% signals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idx-fixture-'));
    try {
      const net = network({ monthly: true, reports: true });
      await ingest({
        data: join(root, 'data'),
        out: join(root, 'out'),
        since: '2026-02-01',
        today: '2026-03-02',
        fetcher: net.fetcher,
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
        fetcher: net.fetcher,
      });
      expect(result.counts).toMatchObject({
        prices: 963,
        indices: 45,
        issuers: 962,
        one_pct: 14411,
        disclosures: 10,
        insiders: 4,
        registry: 4,
      });
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
      expect(aadi.registry).toBeNull();
      expect(aadi.insiders).toEqual([]);
      expect(aadi.disclosures).toContainEqual({
        id: 'registry/unsupported',
        title: 'Laporan Bulanan Registrasi Pemegang Efek',
        published_at: '2026-10-21T10:00:00',
        kind: 'registry',
        url: 'https://www.idx.id/StaticData/From_EREP/unsupported.pdf',
        attachments: [
          { name: 'report.pdf', url: 'https://www.idx.id/StaticData/From_EREP/unsupported.pdf' },
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
        expect(ticker.registry).toEqual({
          date: '2026-05-31',
          free_float_pct: r.pct,
          total_shares: null,
          sid_count: r.sid,
          url: `https://www.idx.id/StaticData/From_EREP/${r.ticker}.pdf`,
        });
        expect(result.report_gaps).toContainEqual({
          id: `registry/${r.ticker}`,
          url: ticker.registry.url,
          reason: 'Registry total shares require a verified table-layout parser',
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
      ).toEqual(['0', '2', '4', '6', '8']);
      expect(JSON.parse(await readFile(join(root, 'out/health.json'), 'utf8'))).toMatchObject({
        prices: '2026-10-21',
        five_pct: '2026-10-21',
        one_pct: '2026-09-30',
      });
      expect(await readdir(join(root, 'data/raw/five-pct'))).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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
      expect(net.urls.every((url) => /data-kepemilikan-saham|GetAnnouncement/.test(url))).toBe(
        true,
      );
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
  });

  it('rejects a truncated announcement page and a failed PDF fetch without publishing empty replacements', async () => {
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
              url.searchParams.get('indexFrom') === '2'
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
      const recovered = await ingest({ ...options, fetcher: net.fetcher });
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
});
