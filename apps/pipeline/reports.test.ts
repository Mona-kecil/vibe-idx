import { readFile } from 'node:fs/promises';
import { expect, it } from 'vite-plus/test';
import { cleanAttachmentLabel, labelAttachments, parseAnnouncements } from './reports';

const file = (name: string, isAttachment = true) => ({
  OriginalFilename: name,
  FullSavePath: `https://www.idx.id/${name}`,
  IsAttachment: isAttachment,
});
const disclosure = (files: ReturnType<typeof file>[]) =>
  parseAnnouncements({
    ResultCount: 1,
    Replies: [
      {
        pengumuman: {
          Id2: 'SINI/cover',
          Kode_Emiten: 'SINI',
          JudulPengumuman: 'Penjelasan',
          TglPengumuman: '2026-10-15T20:03:10',
        },
        attachments: files,
      },
    ],
  }).disclosures[0];
const coverBytes = (day: string) =>
  readFile(new URL(`./fixtures/SINI-${day}-cover.pdf`, import.meta.url));

it('puts the cover before shuffled numeric lamps and retains other source order', () => {
  const d = disclosure([
    file('other.zip'),
    file('report_lamp10.pdf'),
    file('report_lamp2.pdf'),
    file('last.xlsx'),
    file('cover.pdf', false),
    file('report_lamp1.pdf'),
  ]);
  expect(d.url).toBe('https://www.idx.id/cover.pdf');
  expect(d.attachments.map((a) => [a.name, a.label])).toEqual([
    ['cover.pdf', null],
    ['report_lamp1.pdf', null],
    ['report_lamp2.pdf', null],
    ['report_lamp10.pdf', null],
    ['other.zip', null],
    ['last.xlsx', null],
  ]);
});

it.each([
  ['2026-10-15', ['surat penyampaian penjelasan bursa', 'Penjelasan tentang Karhutla']],
  ['2026-09-10', ['Surat Penyampaian Materi PE Insidentil', 'Presentation 030926 IND PUBEX']],
])(
  'reads the real %s Lampiran table without changing casing or labeling the cover',
  async (day, labels) => {
    const d = disclosure([
      file('report_lamp2.pdf'),
      file('cover.pdf', false),
      file('report_lamp1.pdf'),
      file('other.zip'),
    ]);
    const attachments = await labelAttachments({
      bytes: await coverBytes(day),
      attachments: d.attachments,
      cover: d.url,
      ticker: d.ticker,
    });
    expect(attachments.map((a) => a.label)).toEqual([null, ...labels, null]);
    expect(attachments.map((a) => a.url)).toEqual(d.attachments.map((a) => a.url));
  },
);

it('leaves labels null for a real cover without a table or a mismatched lamp count or number', async () => {
  for (const [day, names] of [
    ['2026-08-19', ['report_lamp1.pdf', 'report_lamp2.pdf']],
    ['2026-10-15', ['report_lamp1.pdf']],
    ['2026-10-15', ['report_lamp1.pdf', 'report_lamp3.pdf']],
  ] satisfies [string, string[]][]) {
    const d = disclosure([file('cover.pdf', false), ...names.map((name) => file(name))]);
    expect(
      await labelAttachments({
        bytes: await coverBytes(day),
        attachments: d.attachments,
        cover: d.url,
        ticker: d.ticker,
      }),
    ).toEqual(d.attachments);
  }
});

it('reads a single-lamp registry cover when PDF text joins the filename to the heading', async () => {
  const d = disclosure([file('cover.pdf', false), file('report_lamp1.pdf')]);
  const attachments = await labelAttachments({
    bytes: await readFile(new URL('./fixtures/SINI-2026-01-main.pdf', import.meta.url)),
    attachments: d.attachments,
    cover: d.url,
    ticker: d.ticker,
  });
  expect(attachments.map((a) => a.label)).toEqual([null, 'Laporan Bulan Januari 2026']);
});

it('strips filename codes and ticker separators while preserving casing and internal codes', () => {
  expect(
    [
      ' SINI_surat__penyampaian  penjelasan bursa E023.PDF ',
      'E123 SINI - Laporan Bulan Agustus 2026.pdf',
      'SINI_E123_Penjelasan tentang Karhutla_E456.PDF',
      'SINI_Presentation_030926_IND_PUBEX .pdf',
      'SINIcatatan E123 internal.xlsx',
    ].map((name) => cleanAttachmentLabel(name, 'SINI')),
  ).toEqual([
    'surat penyampaian penjelasan bursa',
    'Laporan Bulan Agustus 2026',
    'Penjelasan tentang Karhutla',
    'Presentation 030926 IND PUBEX',
    'SINIcatatan E123 internal',
  ]);
});
