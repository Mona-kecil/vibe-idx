import { date, fiveHolding, number } from './rows';
import type { FiveHolding } from './rows';
import { readSheet } from './xlsx';
function headerDate(text: string): string {
  const match = /(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})/.exec(text);
  if (!match) throw new Error(`Missing ownership date: ${text}`);
  const month =
    ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(
      (match[2] ?? '').toUpperCase(),
    ) + 1;
  return date(`${match[3]}-${String(month).padStart(2, '0')}-${(match[1] ?? '').padStart(2, '0')}`);
}
type Columns = Record<
  | 'ticker'
  | 'issuer'
  | 'holder'
  | 'investor'
  | 'account'
  | 'nationality'
  | 'domicile'
  | 'localForeign'
  | 'previousShares'
  | 'previousCombined'
  | 'previousPercent'
  | 'currentShares'
  | 'currentCombined'
  | 'currentPercent',
  number
>;
const FIELDS = {
  ticker: 'Kode Efek',
  issuer: 'Nama Emiten',
  holder: 'Nama Pemegang Rekening Efek',
  investor: 'Nama Pemegang Saham',
  account: 'Nama Rekening Efek',
  nationality: 'Kebangsaan',
  domicile: 'Domisili',
  localForeign: 'Status (Lokal/Asing)',
} as const;
const AMOUNTS = {
  Shares: 'Jumlah Saham',
  Combined: 'Saham Gabungan Per Investor',
  Percent: 'Persentase Kepemilikan Per Investor (%)',
} as const;

function xlsxColumns(names: string[], amounts: string[]): Columns {
  const find = (label: string, from = 0, to = names.length) => {
    const i = names.findIndex((n, j) => j >= from && j < to && n?.trim() === label);
    if (i < 0) throw new Error(`Missing 5% column: ${label}`);
    return i;
  };
  const dates = names.flatMap((n, i) => (/\d{1,2}[- ][A-Za-z]{3}[- ]\d{4}/.test(n) ? [i] : []));
  if (dates.length !== 2) throw new Error('Expected two 5% snapshot date columns');
  const [previous, current] = dates as [number, number];
  const group = (prefix: 'previous' | 'current', from: number, to: number) =>
    Object.fromEntries(
      Object.entries(AMOUNTS).map(([field, label]) => {
        const i = amounts.findIndex((n, j) => j >= from && j < to && n?.trim() === label);
        if (i < 0) throw new Error(`Missing 5% column: ${label} under ${names[from]}`);
        return [prefix + field, i];
      }),
    );
  return {
    ...(Object.fromEntries(
      Object.entries(FIELDS).map(([field, label]) => [field, find(label)]),
    ) as Pick<Columns, keyof typeof FIELDS>),
    ...group('previous', previous, current),
    ...group('current', current, current + Object.keys(AMOUNTS).length),
  } as Columns;
}

export function parseFivePct(bytes: Uint8Array) {
  const sheet = readSheet(bytes);
  const header = sheet.findIndex((r) => r.some((c) => c?.trim() === FIELDS.ticker));
  if (header < 0) throw new Error('Missing 5% headers');
  return parseFiveRows(sheet, header, xlsxColumns(sheet[header]!, sheet[header + 1] ?? []));
}

function parseFiveRows(sheet: string[][], header: number, c: Columns) {
  const previousDate = headerDate(sheet[header]?.[c.previousShares] ?? '');
  const asOf = headerDate(sheet[header]?.[c.currentShares] ?? '');
  const groups: {
    holding: FiveHolding;
    previousCombined: number;
    previousPercent: number;
    accounts: {
      holderName: string;
      accountName: string;
      previousShares: number;
      currentShares: number;
    }[];
  }[] = [];
  let group: (typeof groups)[number] | undefined;
  for (const r of sheet.slice(header + 2)) {
    const cell = (column: keyof Columns) => r[c[column]]?.trim() ?? '';
    if (!cell('holder') && !cell('investor') && !cell('previousShares') && !cell('currentShares'))
      continue;
    if (cell('investor')) {
      group = {
        holding: fiveHolding.parse({
          ticker: cell('ticker'),
          investorName: cell('investor'),
          issuerName: cell('issuer'),
          asOf,
          combinedShares: number(cell('currentCombined')),
          percent: number(cell('currentPercent')),
          localForeign: cell('localForeign'),
          nationality: cell('nationality') || undefined,
          domicile: cell('domicile') || undefined,
          accounts: [],
        }),
        previousCombined: number(cell('previousCombined')),
        previousPercent: number(cell('previousPercent')),
        accounts: [],
      };
      groups.push(group);
    }
    if (!group) throw new Error('Account without investor');
    const account = {
      holderName: cell('holder'),
      accountName: cell('account'),
      previousShares: number(cell('previousShares')),
      currentShares: number(cell('currentShares')),
    };
    group.accounts.push(account);
    group.holding.accounts.push({
      holderName: account.holderName,
      accountName: account.accountName,
      shares: account.currentShares,
    });
  }
  const merged = new Map<string, (typeof groups)[number]>();
  for (const group of groups) {
    const key = JSON.stringify([group.holding.ticker, group.holding.investorName]);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, group);
      continue;
    }
    existing.holding.combinedShares += group.holding.combinedShares;
    existing.holding.percent =
      Math.round((existing.holding.percent + group.holding.percent) * 100) / 100;
    existing.previousCombined += group.previousCombined;
    existing.previousPercent =
      Math.round((existing.previousPercent + group.previousPercent) * 100) / 100;
    existing.holding.accounts.push(...group.holding.accounts);
    existing.accounts.push(...group.accounts);
  }
  return { asOf, previousDate, groups: [...merged.values()] };
}
