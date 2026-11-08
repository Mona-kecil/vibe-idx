import { date, number, oneHolding } from './rows';
import { readSheet } from './xlsx';
const COLUMNS = {
  date: ['DATE'],
  ticker: ['SHARE_CODE'],
  issuerName: ['ISSUER_NAME'],
  investorName: ['INVESTOR_NAME'],
  classification: ['INVESTOR_CLASSIFICATION', 'INVESTOR_TYPE'],
  localForeign: ['LOCAL_FOREIGN'],
  nationality: ['NATIONALITY'],
  domicile: ['DOMICILE'],
  scripless: ['HOLDINGS_SCRIPLESS'],
  scrip: ['HOLDINGS_SCRIP'],
  total: ['TOTAL_HOLDING_SHARES'],
  percent: ['PERCENTAGE'],
};
type Column = keyof typeof COLUMNS;
export function parseOnePct(bytes: Uint8Array) {
  const sheet = readSheet(bytes);
  const header = sheet.findIndex((r) => r[0] === 'DATE' && r[1] === 'SHARE_CODE');
  if (header < 0) throw new Error('Missing 1% headers');
  const names = sheet[header]!.map((name) => name.trim());
  const index = Object.fromEntries(
    Object.entries(COLUMNS).map(([column, accepted]) => {
      const i = names.findIndex((name) => accepted.includes(name));
      if (i < 0) throw new Error(`Missing 1% column: ${accepted.join(' or ')}`);
      return [column, i];
    }),
  ) as Record<Column, number>;
  const occurrences = new Map<string, number>();
  return sheet
    .slice(header + 1)
    .map((r) => (column: Column) => r[index[column]]?.trim() ?? '')
    .filter((cell) => cell('ticker'))
    .map((cell) => {
      const key = JSON.stringify([cell('ticker'), cell('investorName')]);
      const seq = occurrences.get(key) ?? 0;
      occurrences.set(key, seq + 1);
      return oneHolding.parse({
        seq,
        asOf: date(
          /^\d+(\.\d+)?$/.test(cell('date'))
            ? new Date(Date.UTC(1899, 11, 30) + number(cell('date')) * 86400000).toISOString()
            : cell('date'),
        ),
        ticker: cell('ticker'),
        issuerName: cell('issuerName'),
        investorName: cell('investorName'),
        classification: cell('classification') || undefined,
        localForeign: cell('localForeign') || undefined,
        nationality: cell('nationality') || undefined,
        domicile: cell('domicile') || undefined,
        scripless: cell('scripless') ? number(cell('scripless')) : undefined,
        scrip: cell('scrip') ? number(cell('scrip')) : undefined,
        total: number(cell('total')),
        percent: number(cell('percent')),
      });
    });
}
