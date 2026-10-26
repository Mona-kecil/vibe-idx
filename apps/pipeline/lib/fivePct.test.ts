import { readFile } from 'node:fs/promises';
import { expect, it } from 'vite-plus/test';
import { parseFivePct, parseFivePctPdf } from './fivePct';

it.each([
  {
    bug: 'date-less continuation pages dropped accounts and left the table incomplete',
    published: '2026-01-09',
    asOf: '2026-01-08',
    ticker: 'ALTO',
    investor: 'PT FIKASA BINTANG CEMERLANG',
    combined: 798633308,
    accounts: 5,
    account: 'FIKASA BINTANG CEMERLANG, PT',
    shares: 16138057,
  },
  {
    bug: 'an investor name split across pages raised conflicting field 4',
    published: '2026-01-12',
    asOf: '2026-01-09',
    ticker: 'SQMI',
    investor: 'CGS INTERNATIONAL SECURITIES SINGAPORE PTE LTD',
    combined: 3433703929,
    accounts: 2,
    account: 'CGS INTERNATIONAL SECURITIES SINGAPORE PTE LTD',
    shares: 3433703829,
  },
  {
    bug: 'watermark text in the unused sequence column raised conflicting field 0',
    published: '2026-03-09',
    asOf: '2026-03-06',
    ticker: 'DCII',
    investor: 'ANTHONI SALIM',
    combined: 265033461,
    accounts: 7,
    account: 'ANTHONI SALIM',
    shares: 4956726,
  },
  {
    bug: 'a short final table page had no borders taller than 50 points',
    published: '2026-04-23',
    asOf: '2026-04-21',
    ticker: 'ZINC',
    investor: 'PT SARANA INTI SELARAS',
    combined: 2470509344,
    accounts: 3,
    account: 'PT SARANA INTI SELARAS',
    shares: 1311028598,
  },
  {
    bug: 'a baseline on the page boundary lost issuer and investor fields',
    published: '2026-05-20',
    asOf: '2026-05-19',
    ticker: 'DIVA',
    investor: 'MARTIN SUHARLIE',
    combined: 116936200,
    accounts: 2,
    account: 'MARTIN SUHARLIE',
    shares: 116670000,
  },
  {
    bug: 'the status-column layout failed and blank custodians dropped continuation accounts',
    published: '2026-05-29',
    asOf: '2026-05-26',
    ticker: 'AADI',
    investor: 'ADARO STRATEGIC INVESTMENTS',
    combined: 3200142830,
    accounts: 11,
    account: 'Adaro Strategic Investments , PT',
    shares: 986784234,
  },
])('parses real PDF rows when $bug', async (source) => {
  const parsed = await parseFivePctPdf(
    await readFile(
      new URL(`../fixtures/ownership-5pct-legacy-${source.published}.pdf`, import.meta.url),
    ),
  );
  expect(parsed.asOf).toBe(source.asOf);
  const group = parsed.groups.find(
    (g) => g.holding.ticker === source.ticker && g.holding.investorName === source.investor,
  );
  expect(group?.holding.combinedShares).toBe(source.combined);
  expect(group?.accounts).toHaveLength(source.accounts);
  expect(group?.accounts).toContainEqual(
    expect.objectContaining({
      accountName: source.account,
      previousShares: source.shares,
      currentShares: source.shares,
    }),
  );
  if (source.published === '2026-05-29') {
    expect(group?.holding.issuerName).toBe('');
    expect(group?.accounts.every((a) => a.holderName === '')).toBe(true);
  }
});

it('keeps clipped second lines and decimal commas in the June PDF alongside the XLSX source', async () => {
  const pdf = await parseFivePctPdf(
    await readFile(
      new URL(
        '../../../samples/idx-5pct/20260608_Semua Emiten Saham_Pengumuman Bursa_32098373_lamp1.pdf',
        import.meta.url,
      ),
    ),
  );
  const xlsx = parseFivePct(
    await readFile(new URL('../fixtures/ownership-5pct-2026-06-05.xlsx', import.meta.url)),
  );
  for (const parsed of [pdf, xlsx]) {
    expect(parsed.asOf).toBe('2026-06-05');
    const group = parsed.groups.find(
      (g) => g.holding.ticker === 'ABMM' && g.holding.investorName === 'DRS LO KHENG HONG',
    );
    expect(group?.accounts).toContainEqual({
      holderName: 'PT OCBC SEKURITAS INDONESIA',
      accountName: 'DRS. LO KHENG HONG',
      previousShares: 441.4,
      currentShares: 441.4,
    });
  }
  expect(pdf.groups.find((g) => g.holding.ticker === 'AADI')?.accounts).toContainEqual(
    expect.objectContaining({
      accountName: 'CITIBANK HONG KONG S/A CPB SG A/C PT ADARO STRATEGIC INVESTMENTS',
      currentShares: 68352699,
    }),
  );
});

function tablePdf(ticker: string, headers: boolean, text = true) {
  const row = [
    '1',
    ticker,
    'ISSUER',
    'HOLDER',
    'INVESTOR',
    'ACCOUNT',
    '',
    '',
    '',
    '',
    'L',
    '100',
    '100',
    '5',
    '200',
    '200',
    '10',
    '100',
  ];
  const commands = [
    ...Array.from({ length: 19 }, (_, i) => `${20 + i * 30} 170 .5 40 re f`),
    '20 170 540 .5 re f',
    '20 210 540 .5 re f',
  ];
  if (text) {
    if (headers)
      commands.push(
        'BT /F1 4 Tf 350 225 Td (Kepemilikan Per 01-JAN-2026) Tj ET',
        'BT /F1 4 Tf 440 225 Td (Kepemilikan Per 02-JAN-2026) Tj ET',
      );
    row.forEach((value, i) => commands.push(`BT /F1 3 Tf ${21 + i * 30} 180 Td (${value}) Tj ET`));
  }
  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 250] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

it('throws for numbered rows with missing or unexpected tickers, missing dates, and absent text', async () => {
  for (const ticker of ['', '???'])
    await expect(parseFivePctPdf(tablePdf(ticker, true))).rejects.toThrow(
      'Unexpected legacy 5% ticker',
    );
  await expect(parseFivePctPdf(tablePdf('TEST', false))).rejects.toThrow(
    'Missing legacy 5% date headers',
  );
  await expect(parseFivePctPdf(tablePdf('TEST', true, false))).rejects.toThrow('has no text items');
});
