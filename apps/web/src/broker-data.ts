import type { BrokerDay } from './brokers';
import directory from './broker-directory.json';

const brokers = new Map(Object.entries(directory.brokers));

export function brokerName(code: string) {
  const row = brokers.get(code);
  return row
    ? row.name +
        ('historicalOnly' in row
          ? ` (historical code; licence revoked ${row.licenseRevokedOn})`
          : '')
    : code;
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
