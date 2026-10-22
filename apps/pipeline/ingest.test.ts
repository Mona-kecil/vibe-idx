import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { ingest } from './ingest';

const fixture = (name: string) =>
  readFile(new URL(`../web/convex/fixtures/${name}`, import.meta.url));

function network() {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
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
    else if (url.pathname.includes('data-kepemilikan-saham')) {
      return Response.json({
        items: ['19', '21'].map((day) => ({
          Description: '',
          Prospectus: `/Media/2026-10-${day}-lima-persen.xlsx`,
          ListingDate: `2026-10-${day}`,
        })),
      });
    } else if (url.pathname.endsWith('-lima-persen.xlsx')) {
      name = `ownership-5pct-${url.pathname.slice('/Media/'.length, -'-lima-persen.xlsx'.length)}.xlsx`;
    } else throw new Error(`Unexpected network call: ${url.href}`);
    return new Response(new Uint8Array(await fixture(name)));
  };
  return { urls, fetcher };
}

describe('batch pipeline', () => {
  it('keeps the BUVA investor purchase and excludes the AADI account transfer from fixture JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idx-fixture-'));
    try {
      const result = await ingest({
        data: join(root, 'data'),
        out: join(root, 'out'),
        since: '2026-10-19',
        today: '2026-10-21',
        fetcher: network().fetcher,
      });
      expect(result.counts).toMatchObject({ prices: 963, indices: 45, issuers: 962 });
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
      expect(JSON.parse(await readFile(join(root, 'out/health.json'), 'utf8'))).toMatchObject({
        prices: '2026-10-21',
        five_pct: '2026-10-21',
      });
      expect(await readdir(join(root, 'data/raw/five-pct'))).toEqual([
        '2026-10-19.xlsx',
        '2026-10-21.xlsx',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not duplicate Parquet rows or rewrite ledger files when the same date runs twice', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idx-replay-'));
    const net = network();
    const options = {
      data: join(root, 'data'),
      out: join(root, 'out'),
      since: '2026-10-21',
      today: '2026-10-21',
      fetcher: net.fetcher,
    };
    try {
      const first = await ingest(options);
      const paths = [
        'prices/2026.parquet',
        'indices/2026.parquet',
        'five_pct/2026.parquet',
        'issuers.parquet',
      ];
      const before = await Promise.all(
        paths.map((p) => readFile(join(options.data, 'parquet', p))),
      );
      await rm(join(options.data, 'raw'), { recursive: true });
      net.urls.length = 0;
      const second = await ingest(options);
      expect(second.counts).toEqual(first.counts);
      expect(second.fetched).toBe(0);
      expect(
        await Promise.all(paths.map((p) => readFile(join(options.data, 'parquet', p)))),
      ).toEqual(before);
      expect(net.urls.every((url) => url.includes('data-kepemilikan-saham'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
