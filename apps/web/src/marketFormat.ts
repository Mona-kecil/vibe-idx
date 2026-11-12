import { nf } from './ticker/format';

export const compact = (n: number | null) => {
  if (n === null) return '—';
  for (const [unit, scale] of [
    ['T', 1e12],
    ['B', 1e9],
    ['M', 1e6],
    ['K', 1e3],
  ] as const)
    if (Math.abs(n) >= scale) return nf(n / scale, 1) + unit;
  return nf(n);
};

export const pct = (n: number | null) =>
  n === null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + nf(Math.abs(n), 2) + '%';
