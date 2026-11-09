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
    { code: string; type: string; buy: number; sell: number; buyValue: number; sellValue: number }
  >();
  for (const day of days)
    for (const side of ['buy', 'sell'] as const)
      for (const row of day[side]) {
        const total = totals.get(row.broker) ?? {
          code: row.broker,
          type: row.investor_type,
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

type Fill = { amount: number; avg: number };
// Only the top 10% of brokers by value on each side set the range, so small trades at odd prices
// can't stretch it.
export function edgeFills<T extends Fill>(buyers: T[], sellers: T[]) {
  const leaders = (list: T[]) =>
      [...list].sort((a, b) => b.amount - a.amount).slice(0, Math.ceil(list.length * 0.1)),
    buys = leaders(buyers),
    sells = leaders(sellers),
    avgs = [...buys, ...sells].map((fill) => fill.avg),
    low = Math.min(...avgs),
    band = (Math.max(...avgs) - low) * 0.25;
  if (!(band > 0)) return new Set<T>();
  return new Set([
    ...buys.filter((fill) => fill.avg <= low + band),
    ...sells.filter((fill) => fill.avg >= low + 3 * band),
  ]);
}
