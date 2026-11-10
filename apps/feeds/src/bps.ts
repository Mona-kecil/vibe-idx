import { z } from 'zod';
import type { CalendarEvent } from './contracts';

export const BPS_HOLIDAYS_URL =
  'https://calendar.google.com/calendar/ical/en.indonesian%23holiday%40group.v.calendar.google.com/public/basic.ics';
const monthly = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const quarterly = [2, 5, 8, 11];
type Rule = { kind: 'first-workday' | 'fifth-or-next'; months: number[] };
export const BPS_SERIES: { ev: string; rule: Rule; match: RegExp }[] = [
  {
    ev: 'Perkembangan Indeks Harga Konsumen',
    rule: { kind: 'first-workday', months: monthly },
    match: /^(?!.*produsen).*\b(?:inflasi|deflasi)\b/s,
  },
  {
    ev: 'Perkembangan Ekspor dan Impor',
    rule: { kind: 'first-workday', months: monthly },
    match: /^(?!.*indeks harga).*\bekspor\b.*\bimpor\b/s,
  },
  {
    ev: 'Indeks Harga Perdagangan Besar',
    rule: { kind: 'first-workday', months: monthly },
    match: /indeks harga perdagangan besar/,
  },
  {
    ev: 'Perkembangan Nilai Tukar Petani',
    rule: { kind: 'first-workday', months: monthly },
    match: /nilai tukar petani|\bntp\b/,
  },
  {
    ev: 'Perkembangan Pariwisata',
    rule: { kind: 'first-workday', months: monthly },
    match: /\b(?:wisman|wisatawan mancanegara|pariwisata)\b/,
  },
  {
    ev: 'Perkembangan Transportasi',
    rule: { kind: 'first-workday', months: monthly },
    match: /transportasi|(?:penumpang|barang).*angkutan/s,
  },
  {
    ev: 'Luas Panen dan Produksi Padi',
    rule: { kind: 'first-workday', months: monthly },
    match: /luas panen padi/,
  },
  {
    ev: 'Luas Panen dan Produksi Jagung',
    rule: { kind: 'first-workday', months: monthly },
    match: /luas panen jagung/,
  },
  {
    ev: 'Indeks Harga Produsen',
    rule: { kind: 'first-workday', months: quarterly },
    match: /harga produsen/,
  },
  {
    ev: 'Perkembangan Indeks Harga Perdagangan Internasional',
    rule: { kind: 'first-workday', months: [3, 6, 9, 12] },
    match: /indeks harga ekspor.*indeks harga impor/s,
  },
  {
    ev: 'Pertumbuhan Ekonomi',
    rule: { kind: 'fifth-or-next', months: quarterly },
    match: /ekonomi indonesia/,
  },
  {
    ev: 'Keadaan Ketenagakerjaan',
    rule: { kind: 'fifth-or-next', months: quarterly },
    match: /tingkat pengangguran terbuka|keadaan ketenagakerjaan/,
  },
  {
    ev: 'Profil Kemiskinan',
    rule: { kind: 'fifth-or-next', months: [2, 8] },
    match: /penduduk miskin|profil kemiskinan/,
  },
  {
    ev: 'Tingkat Ketimpangan Pengeluaran Penduduk',
    rule: { kind: 'fifth-or-next', months: [2, 8] },
    match: /gini ratio|ketimpangan pengeluaran/,
  },
  {
    ev: 'Indeks Kondisi dan Prospek Bisnis Industri Manufaktur (IKBM)',
    rule: { kind: 'fifth-or-next', months: [8, 11] },
    match: /\bikbm\b/,
  },
  {
    ev: 'Indeks Pembangunan Manusia (IPM)',
    rule: { kind: 'fifth-or-next', months: [11] },
    match: /indeks pembangunan manusia/,
  },
];

export function parsePublicHolidays(ics: string): Set<string> {
  const lines = ics
    .replace(/\r?\n[ \t]/g, '')
    .trim()
    .split(/\r?\n/);
  if (lines[0] !== 'BEGIN:VCALENDAR' || lines.at(-1) !== 'END:VCALENDAR')
    throw new Error('Invalid holiday calendar');
  const holidays = new Set<string>();
  let event: Map<string, string> | undefined;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      if (event) throw new Error('Nested holiday event');
      event = new Map();
    } else if (line === 'END:VEVENT') {
      if (!event) throw new Error('Unexpected holiday event end');
      const raw = event.get('DTSTART;VALUE=DATE');
      if (!raw || !/^\d{8}$/.test(raw) || !event.has('DESCRIPTION'))
        throw new Error('Invalid holiday event');
      const date = z.iso.date().parse(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`);
      if (event.get('DESCRIPTION')?.startsWith('Public holiday')) holidays.add(date);
      event = undefined;
    } else if (event) {
      const colon = line.indexOf(':');
      if (colon < 1) throw new Error('Invalid holiday property');
      event.set(line.slice(0, colon), line.slice(colon + 1));
    }
  }
  if (event || !holidays.size) throw new Error('Incomplete holiday calendar');
  return holidays;
}

const day = 86400e3;
const wib = 7 * 3600e3;
export function bpsDate(year: number, month: number, rule: Rule, holidays: Set<string>): string {
  const date = new Date(Date.UTC(year, month - 1, rule.kind === 'first-workday' ? 1 : 5));
  while ([0, 6].includes(date.getUTCDay()) || holidays.has(date.toISOString().slice(0, 10)))
    date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function expectedBPS(
  now: Date,
  holidays: Set<string>,
  releases: CalendarEvent[],
): CalendarEvent[] {
  const local = new Date(now.getTime() + wib);
  return [0, 1].flatMap((offset) => {
    const month = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + offset, 1));
    const year = month.getUTCFullYear();
    if (![...holidays].some((date) => date.startsWith(`${year}-`)))
      throw new Error('Holiday calendar missing expected year');
    return BPS_SERIES.filter((series) =>
      series.rule.months.includes(month.getUTCMonth() + 1),
    ).flatMap((series) => {
      const date = bpsDate(year, month.getUTCMonth() + 1, series.rule, holidays);
      const ts = new Date(`${date}T00:00:00+07:00`).toISOString();
      if (
        now.getTime() - Date.parse(ts) > 7 * day ||
        releases.some((release) => {
          const actual = new Date(Date.parse(release.ts) + wib).toISOString().slice(0, 10);
          return (
            series.match.test(release.ev.toLowerCase()) &&
            (actual.slice(0, 7) === date.slice(0, 7) ||
              Math.abs(Date.parse(actual) - Date.parse(date)) <= 7 * day)
          );
        })
      )
        return [];
      return [
        {
          ts,
          c: 'ID',
          imp: 2,
          ev: series.ev,
          by: 'BPS',
          url: 'https://www.bps.go.id/id/pressrelease',
          est: "Expected from BPS's usual release schedule; replaced when BPS publishes",
          source_id: 'bps',
        },
      ];
    });
  });
}
