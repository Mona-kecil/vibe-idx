import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vite-plus/test';
import { parseFivePct } from './fivePct';
import { parseOnePct } from './onePct';
import { parsePrices } from './prices';
import { parseIndices } from './indices';
import { parseIssuers } from './issuers';
import { parseOwnershipList } from './ownershipList';
const bytes = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
const json = (name: string): unknown => JSON.parse(bytes(name).toString());
const five = parseFivePct(bytes('ownership-5pct-2026-10-19.xlsx'));
type Cell = string | { bool: string };
const workbook = (rows: Cell[][]) =>
  zipSync({
    'xl/worksheets/sheet1.xml': strToU8(
      `<worksheet><sheetData>${rows
        .map(
          (cells, r) =>
            `<row r="${r + 1}">${cells
              .map((c, i) => {
                const ref = `${String.fromCharCode(65 + i)}${r + 1}`;
                if (typeof c === 'object') return `<c r="${ref}" t="b"><v>${c.bool}</v></c>`;
                return c ? `<c r="${ref}" t="inlineStr"><is><t>${c}</t></is></c>` : '';
              })
              .join('')}</row>`,
        )
        .join('')}</sheetData></worksheet>`,
    ),
  });
const fiveHeader = [
  ['No', 'Kode Efek', 'Nama Emiten', 'Nama Pemegang Rekening Efek', 'Nama Pemegang Saham'],
  ['Nama Rekening Efek', 'Alamat', 'Alamat (Lanjutan)', 'Kebangsaan', 'Domisili'],
  ['Status (Lokal/Asing)', '21-Oct-2026', '', '', '22-Oct-2026', '', '', 'Perubahan'],
].flat();
const fiveAmounts = [
  ...Array<string>(11).fill(''),
  ...['Jumlah Saham', 'Saham Gabungan Per Investor', 'Persentase Kepemilikan Per Investor (%)'],
  ...['Jumlah Saham', 'Saham Gabungan Per Investor', 'Persentase Kepemilikan Per Investor (%)'],
  '',
];
const fiveRow = (ticker: Cell) => [
  ...['1', ticker, 'TRINITI DINAMIK Tbk, PT', 'HOLDER', 'INVESTOR', 'ACCOUNT', '', ''],
  ...['INDONESIA', 'INDONESIA', 'L', '100', '100', '5.1', '120', '120', '6.1', '20'],
];

describe('IDX fixture ingestion', () => {
  it.each([
    ['1', 'TRUE'],
    ['0', 'FALSE'],
  ])('keeps Excel boolean ticker %s as %s in both ownership parsers', (value, ticker) => {
    const five = workbook([fiveHeader, fiveAmounts, fiveRow({ bool: value })]);
    const one = workbook([
      [
        ...['DATE', 'SHARE_CODE', 'ISSUER_NAME', 'INVESTOR_NAME', 'INVESTOR_CLASSIFICATION'],
        ...['LOCAL_FOREIGN', 'NATIONALITY', 'DOMICILE', 'HOLDINGS_SCRIPLESS', 'HOLDINGS_SCRIP'],
        ...['TOTAL_HOLDING_SHARES', 'PERCENTAGE'],
      ],
      ['2026-09-30', { bool: value }, 'TRINITI DINAMIK Tbk, PT', 'INVESTOR'],
    ]);
    expect.soft(parseFivePct(five).groups.map((g) => g.holding.ticker)).toEqual([ticker]);
    expect.soft(parseOnePct(one).map((r) => r.ticker)).toEqual([ticker]);
  });
  it('reads 5% columns by header when IDX inserts or drops a column', () => {
    const insert = (row: Cell[], at: number, cell: Cell) => [
      ...row.slice(0, at),
      cell,
      ...row.slice(at),
    ];
    const base = parseFivePct(workbook([fiveHeader, fiveAmounts, fiveRow('TRIN')]));
    expect(base.groups[0]?.holding).toMatchObject({ combinedShares: 120, percent: 6.1 });
    expect(
      parseFivePct(
        workbook([
          insert(fiveHeader, 11, 'Tipe Investor'),
          insert(fiveAmounts, 11, ''),
          insert(fiveRow('TRIN'), 11, 'CP'),
        ]),
      ),
    ).toEqual(base);
    expect(() =>
      parseFivePct(
        workbook([
          fiveHeader.map((h) => (h === 'Domisili' ? 'Domicile' : h)),
          fiveAmounts,
          fiveRow('TRIN'),
        ]),
      ),
    ).toThrow('Missing 5% column: Domisili');
  });
  it('retains investor identity and combined totals across 5% continuation accounts', () => {
    expect(five.asOf).toBe('2026-10-19');
    expect(five.previousDate).toBe('2026-10-16');
    expect(five.groups).toHaveLength(1915);
    const group = five.groups.find(
      (g) =>
        g.holding.ticker === 'AADI' && g.holding.investorName === 'ADARO STRATEGIC INVESTMENTS',
    );
    expect(group?.holding).toMatchObject({
      ticker: 'AADI',
      investorName: 'ADARO STRATEGIC INVESTMENTS',
      combinedShares: 3200142830,
      percent: 41.1,
      localForeign: 'L',
      domicile: 'INDONESIA',
    });
    expect(group?.holding.accounts).toHaveLength(10);
    expect(group?.holding.accounts[1]).toEqual({
      holderName: 'BUT DEUTSCHE BANK AG',
      accountName: 'UBS AG SG BRANCH TR AC CL PT ADARO STRA IN -2023904118',
      shares: 34176349,
    });
    expect(group?.holding.accounts.reduce((sum, a) => sum + a.shares, 0)).toBe(3200142830);
    expect(JSON.stringify(five)).not.toContain('Data tidak ditampilkan');
    expect(
      five.groups.find(
        (g) =>
          g.holding.ticker === 'CPGT' &&
          g.holding.investorName === 'ASIA ARGENTUM ASSETS HONG KONG LIMITED',
      )?.holding,
    ).toMatchObject({
      combinedShares: 1156687126,
      percent: 29.12,
      accounts: [
        expect.objectContaining({ shares: 324374252 }),
        expect.objectContaining({ shares: 832312874 }),
      ],
    });
  });
  it('reads all 1% rows after disclaimers and converts Excel dates and numbers', () => {
    const rows = parseOnePct(bytes('ownership-1pct-2026-09.xlsx'));
    expect(rows).toHaveLength(7154);
    expect(rows[0]).toEqual({
      asOf: '2026-09-30',
      seq: 0,
      ticker: 'AADI',
      issuerName: 'ADARO ANDALAN INDONESIA Tbk',
      investorName: 'PT PERSADA CAPITAL INVESTAMA',
      classification: 'Corporate',
      localForeign: 'L',
      nationality: undefined,
      domicile: 'INDONESIA',
      scripless: 119887170,
      scrip: 0,
      total: 119887170,
      percent: 1.54,
    });
  });
  it('reads 1% columns by header after IDX inserts a column', () => {
    const rows = parseOnePct(bytes('ownership-1pct-2026-10.xlsx'));
    expect(rows[0]).toEqual({
      asOf: '2026-10-30',
      seq: 0,
      ticker: 'AADI',
      issuerName: 'ADARO ANDALAN INDONESIA Tbk',
      investorName: 'PERSADA CAPITAL INVESTAMA PT',
      classification: 'Corporate',
      localForeign: 'L',
      nationality: undefined,
      domicile: 'INDONESIA',
      scripless: 119887170,
      scrip: 0,
      total: 119887170,
      percent: 1.54,
    });
  });
  it('keeps duplicate 1% investors as separate rows in file order', () => {
    const rows = parseOnePct(bytes('ownership-1pct-2026-02.xlsx'));
    expect(rows).toHaveLength(7257);
    expect(
      rows
        .filter((r) => r.ticker === 'ICON' && r.investorName === 'ISLAND REGENCY GROUP LIMITED')
        .map(({ asOf, seq, total, percent }) => ({ asOf, seq, total, percent })),
    ).toEqual([
      { asOf: '2026-02-27', seq: 0, total: 42187000, percent: 3.87 },
      { asOf: '2026-02-27', seq: 1, total: 20000000, percent: 1.84 },
    ]);
  });
  it('keeps every stock and COMPOSITE index row and rejects truncated responses', () => {
    const prices = parsePrices(json('stock-summary-idxid.json'));
    expect(prices).toHaveLength(963);
    expect(prices[0]).toEqual({
      date: '2026-10-20',
      ticker: 'AADI',
      previous: 10175,
      open: 10450,
      high: 10950,
      low: 10300,
      close: 10950,
      change: 775,
      volume: 20132300,
      value: 215030807500,
      frequency: 13438,
      foreignBuy: 3299600,
      foreignSell: 11209200,
      listedShares: 7786891760,
      tradableShares: 7786891760,
      remarks: '--MO1SD0F70000A121------------',
    });
    expect(parseIndices(json('index-summary-idxid.json'))).toHaveLength(45);
    expect(parseIndices(json('index-summary-idxid.json'))[0]).toMatchObject({
      date: '2026-10-20',
      code: 'COMPOSITE',
      previous: 4996.609,
      high: 5278.888,
      low: 4980.163,
      close: 5278.888,
      change: 282.279,
    });
    expect(parsePrices({ recordsTotal: 0, data: [] })).toEqual([]);
    expect(() => parsePrices({ recordsTotal: 1, data: [] })).toThrow('Incomplete');
  });
  it('classifies ownership files with dates, rewrites the host, and sorts oldest first', () => {
    const files = parseOwnershipList(json('ownership-list-2026-all.json'));
    expect(files.filter((f) => f.source === 'fivePct')).toHaveLength(98);
    expect(files.filter((f) => f.source === 'onePct')).toHaveLength(8);
    expect(files.filter((f) => f.source === 'fivePct')[0]).toMatchObject({ date: '2026-05-29' });
    expect(files.find((f) => f.url.endsWith('peng-2026-09-00024-satu-persen.xlsx'))).toEqual({
      source: 'onePct',
      date: '2026-09-30',
      url: 'https://www.idx.id/Media/yqjhhsee/peng-2026-09-00024-satu-persen.xlsx',
    });
    expect(files.every((f) => new URL(f.url).hostname === 'www.idx.id')).toBe(true);
  });
  it('preserves issuer board and industry fields from the company response', () => {
    const rows = parseIssuers(json('company-profiles.json'), 123);
    expect(rows).toHaveLength(962);
    expect(rows[0]).toEqual({
      ticker: 'AADI',
      name: 'PT Adaro Andalan Indonesia Tbk',
      board: 'Utama',
      sector: 'Energi',
      subSector: 'Minyak, Gas & Batu Bara',
      industry: 'Batu Bara',
      subIndustry: 'Produksi Batu Bara',
      updatedAt: 123,
    });
  });
});
