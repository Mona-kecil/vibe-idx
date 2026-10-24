import type { BrokerDay } from './brokers';
import directory from './broker-directory.json';
import type { ChartSeries } from './Chart';

const brokers = new Map(Object.entries(directory.brokers));
const aliases = new Map(Object.entries(directory.aliases));

export function brokerName(code: string) {
  const row = brokers.get(code);
  return row
    ? row.name +
        ('historicalOnly' in row
          ? ` · historical code; licence revoked ${row.licenseRevokedOn}`
          : '')
    : code;
}
export function accountIdentity(
  name: string,
): { kind: 'broker'; code: string } | { kind: 'custodian'; name: string } | null {
  const normalize = (text: string) =>
    text
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, ' ')
      .split(/\s+/)
      .filter((token) => token && !['PT', 'TBK'].includes(token))
      .join(' ');
  const normalized = normalize(name);
  const custodian = directory.custodians.find((row) => row.normalizedName === normalized);
  if (custodian) return { kind: 'custodian', name: custodian.name };
  const code = aliases.get(normalized);
  return code ? { kind: 'broker', code } : null;
}
export function aggregateBrokers(days: BrokerDay[]) {
  const totals = new Map<
    string,
    { code: string; buy: number; sell: number; buyValue: number; sellValue: number }
  >();
  for (const day of days)
    for (const side of ['buy', 'sell'] as const)
      for (const row of day[side]) {
        const total = totals.get(row.broker) ?? {
          code: row.broker,
          buy: 0,
          sell: 0,
          buyValue: 0,
          sellValue: 0,
        };
        if (side === 'buy') {
          total.buy += row.shares;
          total.buyValue += row.value;
        } else {
          total.sell += row.shares;
          total.sellValue += row.value;
        }
        totals.set(row.broker, total);
      }
  return [...totals.values()];
}
export function defaultBrokerCodes(days: BrokerDay[]) {
  const rows = aggregateBrokers(days).sort(
    (a, b) => b.buy - b.sell - (a.buy - a.sell) || a.code.localeCompare(b.code),
  );
  const buyers = rows.filter((row) => row.buy > row.sell).slice(0, 2);
  const sellers = rows
    .filter((row) => row.sell > row.buy)
    .reverse()
    .slice(0, 2);
  return [...new Set([...buyers, ...sellers].map((row) => row.code))];
}
export function inventorySeries(
  days: BrokerDay[],
  dates: string[],
  codes: string[],
  unit: 'shares' | 'value',
): ChartSeries[] {
  const byDate = new Map(days.map((day) => [day.date, aggregateBrokers([day])]));
  const colors = ['#3d755a', '#47859a', '#ab6a53', '#89733e', '#786397', '#697e4d'];
  return codes.map((code, index) => {
    let balance = 0;
    let complete = true;
    return {
      label: code,
      color: colors[index % colors.length] ?? '#3d755a',
      points: dates.map((date) => {
        const rows = byDate.get(date);
        if (!rows) {
          complete = false;
          return { date, value: null, delta: null };
        }
        const row = rows.find((row) => row.code === code);
        const delta = row
          ? unit === 'shares'
            ? row.buy - row.sell
            : row.buyValue - row.sellValue
          : 0;
        balance += delta;
        return { date, value: complete ? balance : null, delta };
      }),
    };
  });
}
