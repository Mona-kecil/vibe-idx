const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
export const money = (value: number) => (value < 0 ? '-' : '') + compact.format(Math.abs(value));

/**
 * Prints rows in aligned columns. `align` has an l or r per column, and by default the first column is left-aligned
 * and the rest right-aligned. An empty header prints no header row.
 */
export function table(
  rows: (string | number)[][],
  header: string[],
  align = 'l'.padEnd(header.length, 'r'),
) {
  const cells = [
    ...(header.some(Boolean) ? [header] : []),
    ...rows.map((row) =>
      row.map((cell) => (typeof cell === 'number' ? cell.toLocaleString('en') : cell)),
    ),
  ];
  const widths = header.map((_, i) => Math.max(...cells.map((row) => row[i]!.length)));
  for (const row of cells)
    console.log(
      row
        .map((cell, i) => (align[i] === 'r' ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!)))
        .join('  ')
        .trimEnd(),
    );
}
