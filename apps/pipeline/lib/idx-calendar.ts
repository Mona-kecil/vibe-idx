import { z } from 'zod';
import type { corporateActionSchema } from '../../web/src/data';
import { decode, type Download, ymd } from './idx-response';

type CorporateAction = z.infer<typeof corporateActionSchema>;
type Step = CorporateAction['steps'][number]['step'];

const calendarSchema = z.object({
  ResultCount: z.number(),
  Results: z.array(
    z.object({
      title: z.string(),
      Jenis: z.string(),
      description: z.string(),
      start: z.string(),
      TglWaktuRups: z.string(),
    }),
  ),
});
type CalendarRow = z.infer<typeof calendarSchema>['Results'][number];

const STEPS: [RegExp, Step][] = [
  [/^cum$/i, 'cum'],
  [/^ex$/i, 'ex'],
  [/^DPS$/i, 'record'],
  [/^Pembayaran$/i, 'pay'],
  [/^distribusi$/i, 'distribution'],
  [/^pencatatan$/i, 'listing'],
  [/^awal perdagangan$/i, 'trade_start'],
  [/^akhir perdagangan$/i, 'trade_end'],
];
const ACTIONS: [RegExp, CorporateAction['kind'], string][] = [
  [/^HMETD/i, 'RIGHTS', 'Rights issue'],
  [/^Saham Bonus/i, 'BONUS', 'Bonus shares'],
  [/^Dividen Saham/i, 'DIV', 'Stock dividend'],
  [/^Dividen Tunai Interim/i, 'DIV', 'Interim dividend'],
  [/^Dividen/i, 'DIV', 'Cash dividend'],
  [/^Pemecahan/i, 'SPLIT', 'Stock split'],
  [/^Penggabungan/i, 'SPLIT', 'Reverse split'],
];

export function corporateActions(rows: CalendarRow[], stocks: Set<string>, from: string) {
  const byKey = new Map<string, CorporateAction>();
  const add = (
    ticker: string,
    kind: CorporateAction['kind'],
    label: string,
    step: Step,
    date: string,
  ) => {
    const key = `${ticker}|${label}`;
    const action = byKey.get(key) ?? { ticker, kind, label, amount: null, steps: [] };
    action.steps = [...action.steps.filter((s) => s.step !== step), { step, date }];
    byKey.set(key, action);
  };
  for (const row of rows) {
    const ticker = row.title.trim();
    if (!stocks.has(ticker)) continue;
    const day = row.start.slice(0, 10);
    const dated = row.description.match(
      /^tanggal\s+(cum|ex|DPS|Pembayaran|distribusi|pencatatan|awal perdagangan|akhir perdagangan)\s+(.+)$/i,
    );
    if (dated) {
      const step = STEPS.find(([re]) => re.test(dated[1]!))![1];
      const action = ACTIONS.find(([re]) => re.test(dated[2]!));
      if (action) add(ticker, action[1], action[2], step, day);
    } else if (row.Jenis === 'Rencana' && /^Pemberitahuan RUPS/i.test(row.description))
      add(ticker, 'RUPS', 'Shareholder meeting', 'meeting', row.TglWaktuRups.slice(0, 16));
    else if (row.Jenis === 'pencatatanAwal') add(ticker, 'IPO', 'Listing', 'listing', day);
    else if (row.Jenis === 'delist') add(ticker, 'DELIST', 'Delisting', 'delisting', day);
  }
  return [...byKey.values()]
    .map((a) => ({ ...a, steps: a.steps.sort((x, y) => x.date.localeCompare(y.date)) }))
    .filter((a) => a.steps.at(-1)!.date >= from)
    .sort((a, b) => a.steps[0]!.date.localeCompare(b.steps[0]!.date));
}

export async function fetchCorporateActions(
  stocks: Set<string>,
  download: Download,
  now = new Date(),
) {
  const month = (offset: number) => {
    const [y, m] = [+ymd(now).slice(0, 4), +ymd(now).slice(4, 6) - 1 + offset];
    return ymd(new Date(Date.UTC(y, m, 1, 12)));
  };
  const rows = (
    await Promise.all(
      [-1, 0, 1].map(async (offset) => {
        const data = calendarSchema.parse(
          decode(
            await download(
              `/primary/Home/GetCalendar?range=m&date=${month(offset)}&indexfrom=0&pagesize=3000`,
            ),
          ),
        );
        if (data.ResultCount !== data.Results.length) throw new Error('Incomplete IDX calendar');
        return data.Results;
      }),
    )
  ).flat();
  const from = new Date(now.getTime() - 7 * 864e5).toISOString().slice(0, 10);
  return corporateActions(rows, stocks, from);
}

// IDX price sessions are the repo's historical trading calendar (sql.ts marketCalendar).
// Unlike generating weekdays, this preserves exchange holidays and exceptional closures.
export function tradingSessions(observed: string[]) {
  return [...new Set(observed.map((day) => z.iso.date().parse(day)))]
    .filter((day) => day >= '2026-01-01' && day < '2027-01-01')
    .sort();
}

export function nextPreOpen(day: string, sessions: string[]) {
  const known = sessions.find((date) => date > day);
  if (known) return Date.parse(`${known}T01:45:00Z`);
  // There is no forward exchange-holiday calendar in this repository. Close the window
  // conservatively at the next weekday instead of attributing a new session's book to an old day.
  const next = new Date(`${day}T01:45:00Z`);
  do {
    next.setUTCDate(next.getUTCDate() + 1);
  } while ([0, 6].includes(next.getUTCDay()));
  return next.getTime();
}
