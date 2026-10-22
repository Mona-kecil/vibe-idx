import { date, number, oneHolding } from './rows';
import { readSheet } from './xlsx';
export function parseOnePct(bytes: Uint8Array) {
  const sheet = readSheet(bytes);
  const header = sheet.findIndex((r) => r[0] === 'DATE' && r[1] === 'SHARE_CODE');
  if (header < 0) throw new Error('Missing 1% headers');
  const occurrences = new Map<string, number>();
  return sheet
    .slice(header + 1)
    .filter((r) => r[1]?.trim())
    .map((r) => {
      const key = JSON.stringify([r[1]?.trim(), r[3]?.trim()]);
      const seq = occurrences.get(key) ?? 0;
      occurrences.set(key, seq + 1);
      return oneHolding.parse({
        seq,
        asOf: date(
          /^\d+(\.\d+)?$/.test(r[0] ?? '')
            ? new Date(Date.UTC(1899, 11, 30) + number(r[0] ?? '') * 86400000).toISOString()
            : (r[0] ?? ''),
        ),
        ticker: r[1]?.trim(),
        issuerName: r[2]?.trim(),
        investorName: r[3]?.trim(),
        classification: r[4]?.trim() || undefined,
        localForeign: r[5]?.trim() || undefined,
        nationality: r[6]?.trim() || undefined,
        domicile: r[7]?.trim() || undefined,
        scripless: r[8] ? number(r[8]) : undefined,
        scrip: r[9] ? number(r[9]) : undefined,
        total: number(r[10] ?? ''),
        percent: number(r[11] ?? ''),
      });
    });
}
