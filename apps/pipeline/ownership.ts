import type { Ticker } from '../web/src/data';

// Only registry labels may be truncated. Account-list entities remain distinct.
export function resolveHolderKeys(data: Ticker) {
  const accounts = [
    ...data.one_pct_history.flatMap((s) => s.holders),
    ...data.one_pct.holders,
    ...data.holders,
    ...data.changes,
  ];
  const keys = new Set(accounts.map((h) => h.holder_key));
  const aliases = new Map<string, string>();
  const ambiguous = new Set<string>();
  const registry = data.registry_history.flatMap((s) =>
    s.holders.map((h) => ({ ...h, month: s.date.slice(0, 7) })),
  );
  for (const key of new Set(registry.map((h) => h.holder_key))) {
    if (keys.has(key) || key.length < 5) continue;
    const candidates = [...keys].filter((candidate) => candidate.startsWith(key));
    if (candidates.length === 1 && candidates[0]) {
      aliases.set(key, candidates[0]);
      continue;
    }
    if (candidates.length < 2) continue;
    const choices = new Set<string>();
    let unresolved = false;
    for (const row of registry.filter((h) => h.holder_key === key)) {
      const monthly = data.one_pct_history.find((s) => s.date.slice(0, 7) === row.month);
      if (!monthly) continue;
      const matching = candidates.filter((candidate) => {
        const rows = monthly.holders.filter((h) => h.holder_key === candidate);
        return rows.length > 0 && Math.abs(rows.reduce((n, h) => n + h.pct, 0) - row.pct) <= 0.02;
      });
      if (matching.length === 1 && matching[0]) choices.add(matching[0]);
      else unresolved = true;
    }
    const choice = [...choices][0];
    if (!unresolved && choices.size === 1 && choice) aliases.set(key, choice);
    else ambiguous.add(key);
  }
  for (const snapshot of data.registry_history)
    for (const holder of snapshot.holders)
      holder.holder_key = aliases.get(holder.holder_key) ?? holder.holder_key;
  return { data, ambiguous };
}
