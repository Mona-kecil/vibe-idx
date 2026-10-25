export const nf = (v: number, d = 0) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
export function short(v: number) {
  const a = Math.abs(v);
  return a >= 1e12
    ? nf(v / 1e12, 1) + 'T'
    : a >= 1e9
      ? nf(v / 1e9, 1) + 'B'
      : a >= 1e6
        ? nf(v / 1e6, 1) + 'M'
        : a >= 1e3
          ? nf(v / 1e3, 1) + 'K'
          : nf(v);
}
export const direction = (v: number | null) =>
  v !== null && v > 0 ? 'up' : v !== null && v < 0 ? 'down' : '';
export const signed = (v: number, format = short) =>
  (v > 0 ? '+' : v < 0 ? '−' : '') + format(Math.abs(v));
export const itemDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : new Date(s).toISOString().slice(0, 10);
export const dateText = (s: string, year = true) =>
  new Date(itemDate(s) + 'T00:00:00Z')
    .toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      ...(year ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    })
    .replace('Sept', 'Sep');
export function rangeText(start: string, end: string, year = false) {
  if (start === end) return dateText(start, year);
  if (start.slice(0, 7) === end.slice(0, 7))
    return Number(start.slice(8)) + '–' + dateText(end, year);
  return dateText(start, start.slice(0, 4) !== end.slice(0, 4)) + '–' + dateText(end, year);
}
