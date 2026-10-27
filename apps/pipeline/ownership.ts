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
        return (
          rows.length > 0 && Math.abs(rows.reduce((n, h) => n + h.pct, 0) - row.pct) <= 0.02 + 1e-9
        );
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

export function ownershipQuality(months: string[]) {
  const conflicts: {
    ticker: string;
    month: string;
    holder: string;
    registry_pct: number;
    one_pct: number | null;
    category: 'missing' | 'differ_small' | 'differ_large' | 'ambiguous_name';
    sources: string[];
  }[] = [];
  return {
    months: [...months].sort(),
    agreement_tolerance_pp: 0.02,
    counts: { agree: 0, missing: 0, differ_small: 0, differ_large: 0, ambiguous_name: 0 },
    conflicts,
  };
}

export function reconcileOwnership(
  report: ReturnType<typeof ownershipQuality>,
  resolved: ReturnType<typeof resolveHolderKeys>,
  sources: Map<string, string[]>,
) {
  const { data, ambiguous } = resolved;
  for (const snapshot of data.registry_history) {
    const month = snapshot.date.slice(0, 7);
    // A month without a published 1% list cannot be compared.
    if (!report.months.includes(month)) continue;
    const monthly = data.one_pct_history.find((s) => s.date.slice(0, 7) === month);
    for (const h of snapshot.holders) {
      if (
        h.pct < 1 ||
        /^(MASYARAKAT|PUBLIK|PUBLIC(?:SHAREHOLDERS|BELOW|LESSTHAN|UNDER|$)|AFILIASI|AFFILIAT|PIHAKTERAFILIASI|SAHAMTREAS|TREASURY|PEMEGANGSAHAM|SHAREHOLDERS|LAINNYA|OTHERS|TOTAL|JUMLAH|PEMDASEJAWA)/.test(
          h.investor.toUpperCase().replace(/[^A-Z]/g, ''),
        )
      )
        continue;
      const matches = monthly?.holders.filter((r) => r.holder_key === h.holder_key) ?? [];
      const pct = matches.length ? matches.reduce((sum, r) => sum + r.pct, 0) : null;
      const delta = pct === null ? null : Math.abs(pct - h.pct);
      const category = ambiguous.has(h.holder_key)
        ? 'ambiguous_name'
        : delta === null
          ? 'missing'
          : delta <= report.agreement_tolerance_pp + 1e-9
            ? 'agree'
            : delta < 1 - 1e-9
              ? 'differ_small'
              : 'differ_large';
      report.counts[category]++;
      if (category !== 'agree')
        report.conflicts.push({
          ticker: data.ticker,
          month,
          holder: h.investor,
          registry_pct: h.pct,
          one_pct: pct,
          category,
          sources: [...new Set([snapshot.url, ...(sources.get(month) ?? [])])],
        });
    }
  }
}
