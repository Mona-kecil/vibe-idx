import { expect, it } from 'vite-plus/test';
import { parseReport } from './reports';

it('does not discard the current registry SID count when its delta is negative', async () => {
  const text =
    'Perihal X Laporan TEST 1 Laporan Bulanan Registrasi Pemegang Efek akhir bulan September - 2026 ' +
    '% Saham Free Float 42,00 41,00 Pernyataan ' +
    'Jumlah Pemegang Saham Nasabah Pemilik SID Bulan Sebelumnya Bulan Sekarang Perubahan 1.000 900 -100';
  const stream = `BT /F1 10 Tf 10 700 Td (${text}) Tj ET`;
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
  const result = await parseReport({
    bytes: new TextEncoder().encode(pdf),
    ticker: 'TEST',
    kind: 'registry',
  });
  expect(result).toEqual({
    kind: 'parsed',
    report: {
      kind: 'registry',
      date: '2026-09-30',
      free_float_pct: 41,
      total_shares: null,
      sid_count: 900,
    },
    gaps: ['Registry total shares require a verified table-layout parser'],
  });
});
