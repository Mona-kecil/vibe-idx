import { extractText } from 'unpdf';
import { z } from 'zod';
import { idxUrl } from './lib/ownershipList';
import { date } from './lib/rows';

const announcementPage = z.object({
  ResultCount: z.number().int().nonnegative(),
  Replies: z.array(
    z.object({
      pengumuman: z.object({
        Id2: z.string().min(1),
        Kode_Emiten: z.string(),
        JudulPengumuman: z.string(),
        TglPengumuman: z.iso.datetime({ local: true, offset: true }),
      }),
      attachments: z.array(
        z.object({
          OriginalFilename: z.string(),
          FullSavePath: z.string().min(1),
          IsAttachment: z.boolean(),
        }),
      ),
    }),
  ),
});

export function parseAnnouncements(input: unknown) {
  const page = announcementPage.parse(input);
  return {
    total: page.ResultCount,
    disclosures: page.Replies.map(({ pengumuman: p, attachments }) => {
      const kind: 'registry' | 'insider' | 'other' =
        /laporan bulanan registrasi pemegang efek/i.test(p.JudulPengumuman)
          ? 'registry'
          : /laporan (?:kepemilikan|perubahan kepemilikan).*saham/i.test(p.JudulPengumuman)
            ? 'insider'
            : 'other';
      const files = attachments.map((a) => ({
        name: a.OriginalFilename,
        url: idxUrl(a.FullSavePath),
        isAttachment: a.IsAttachment,
      }));
      const primary = files.find((a) => !a.isAttachment) ?? files[0];
      const code = p.Kode_Emiten.trim();
      return {
        id: p.Id2,
        ticker: /^[A-Z0-9-]{2,12}$/.test(code) ? code : null,
        title: p.JudulPengumuman,
        published_at: p.TglPengumuman,
        url: primary?.url ?? idxUrl('/id/perusahaan-tercatat/keterbukaan-informasi/'),
        kind,
        attachments: files.map(({ name, url }) => ({ name, url })),
        reports: files.filter(
          (a) =>
            /\.pdf$/i.test(new URL(a.url).pathname) &&
            (kind === 'registry'
              ? a === primary
              : kind === 'insider' &&
                ((/^LK-/i.test(a.name) && /\/From_KSEI\//i.test(a.url)) ||
                  (a.isAttachment && /_lamp\d/i.test(a.name)))),
        ),
      };
    }),
  };
}

type InsiderReport = {
  kind: 'insider';
  date: string;
  reporter: string;
  shares_before: number | null;
  shares_after: number | null;
  net_shares: number | null;
};
type RegistryReport = {
  kind: 'registry';
  date: string;
  free_float_pct: number | null;
  total_shares: number | null;
  sid_count: number | null;
};
type ReportResult =
  | { kind: 'parsed'; report: InsiderReport | RegistryReport; gaps: string[] }
  | { kind: 'unsupported'; reason: string };

const months = [
  'januari',
  'februari',
  'maret',
  'april',
  'mei',
  'juni',
  'juli',
  'agustus',
  'september',
  'oktober',
  'november',
  'desember',
];
const integer = (text: string) => Number(text.replaceAll('.', '').replace(/,00$/, ''));

export async function parseReport({
  bytes,
  kind,
  ticker,
}: {
  bytes: Uint8Array;
  kind: 'insider' | 'registry';
  ticker: string;
}): Promise<ReportResult> {
  let pages: string[];
  try {
    const extracted = await extractText(new Uint8Array(bytes), { mergePages: false });
    pages = extracted.text;
  } catch (error) {
    if (error instanceof Error && ['InvalidPDFException', 'PasswordException'].includes(error.name))
      return { kind: 'unsupported', reason: `Unreadable PDF: ${error.name}` };
    throw error;
  }
  const first = (pages[0] ?? '').replace(/\s+/g, ' ');
  if (kind === 'insider') {
    const code = /Nama Perusahaan Tbk\s*:\s*([A-Z0-9-]+)\s+-/.exec(first)?.[1];
    const reporter = /Nama \(sesuai SID\)\s*:\s*(.*?)\s+Anggota Direksi/.exec(first)?.[1];
    const reported = /\b(\d{2}) ([A-Za-z]+) (\d{4})\b/.exec(first);
    const month = months.indexOf(reported?.[2]?.toLowerCase() ?? '') + 1;
    if (code !== ticker || !reporter || !reported || !month)
      return { kind: 'unsupported', reason: 'Unrecognized KSEI insider report header or date' };
    const before = /Jumlah Saham Sebelum Transaksi\s*:\s*([\d.]+,00)\s+Unit/.exec(first)?.[1];
    const after = /Jumlah Saham Setelah Transaksi\s*:\s*([\d.]+,00)\s+Unit/.exec(first)?.[1];
    const shares_before = before ? integer(before) : null;
    const shares_after = after ? integer(after) : null;
    return {
      kind: 'parsed',
      report: {
        kind,
        date: date(`${reported[3]}-${String(month).padStart(2, '0')}-${reported[1]}`),
        reporter,
        shares_before,
        shares_after,
        net_shares:
          shares_before !== null && shares_after !== null ? shares_after - shares_before : null,
      },
      gaps:
        before && after
          ? []
          : ['Insider before/after shares are not in the supported numeric format'],
    };
  }
  const code = /Perihal \S+ .*? ([A-Z0-9-]+) \d+ Laporan Bulanan Registrasi Pemegang Efek/.exec(
    first,
  )?.[1];
  const period = /akhir bulan ([A-Za-z]+)\s*-\s*(\d{4})/i.exec(first);
  const month = months.indexOf(period?.[1]?.toLowerCase() ?? '') + 1;
  if (code !== ticker || !period || !month)
    return {
      kind: 'unsupported',
      reason: 'Unrecognized IDX registry report header or reporting month',
    };
  const text = pages.join(' ').replace(/\s+/g, ' ');
  const section =
    /% Saham Free Float\s+(.*?)(?:Jumlah saham yang harus dibatasi|Pernyataan|$)/i.exec(
      text,
    )?.[1] ?? '';
  const percentages = Array.from(
    section.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{1,4}|\.\d{1,4}))(?![\d.,])/g),
    (m) => Number(m[1]?.replace(',', '.')),
  ).filter((n) => n <= 100);
  const sid =
    /Jumlah Pemegang Saham Nasabah Pemilik SID Bulan Sebelumnya Bulan Sekarang Perubahan ([\d.]+) ([\d.]+) (-?[\d.]+)/.exec(
      text,
    )?.[2];
  const free_float_pct = percentages.length === 2 ? (percentages[1] ?? null) : null;
  return {
    kind: 'parsed',
    report: {
      kind,
      date: new Date(Date.UTC(Number(period[2]), month, 0)).toISOString().slice(0, 10),
      free_float_pct,
      total_shares: null,
      sid_count: sid ? integer(sid) : null,
    },
    gaps: [
      'Registry total shares require a verified table-layout parser',
      ...(free_float_pct === null
        ? ['Registry free float is not in the supported two-column format']
        : []),
      ...(!sid ? ['Registry SID count is not in the supported labeled format'] : []),
    ],
  };
}
