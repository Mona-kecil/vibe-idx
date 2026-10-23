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
export function parseFivePct(bytes: Uint8Array) {
  const sheet = readSheet(bytes);
  const header = sheet.findIndex((r) => r[1] === 'Kode Efek');
  if (header < 0) throw new Error('Missing 5% headers');
  const previousDate = headerDate(sheet[header]?.[11] ?? '');
  const asOf = headerDate(sheet[header]?.[14] ?? '');
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
    if (!r[3]?.trim() && !r[4]?.trim()) continue;
    if (r[4]?.trim()) {
      group = {
        holding: fiveHolding.parse({
          ticker: r[1]?.trim(),
          investorName: r[4].trim(),
          issuerName: r[2]?.trim(),
          asOf,
          combinedShares: number(r[15] ?? ''),
          percent: number(r[16] ?? ''),
          localForeign: r[10]?.trim() ?? '',
          nationality: r[8]?.trim() || undefined,
          domicile: r[9]?.trim() || undefined,
          accounts: [],
        }),
        previousCombined: number(r[12] ?? ''),
        previousPercent: number(r[13] ?? ''),
        accounts: [],
      };
      groups.push(group);
    }
    if (!group) throw new Error('Account without investor');
    const account = {
      holderName: r[3]?.trim() ?? '',
      accountName: r[5]?.trim() ?? '',
      previousShares: number(r[11] ?? ''),
      currentShares: number(r[14] ?? ''),
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
