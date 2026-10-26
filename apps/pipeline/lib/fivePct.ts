import { date, fiveHolding, number } from './rows';
import type { FiveHolding } from './rows';
import { readSheet } from './xlsx';
import { getDocumentProxy, getResolvedPDFJS } from 'unpdf';
import { z } from 'zod';
function headerDate(text: string): string {
  const match = /(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})/.exec(text);
  if (!match) throw new Error(`Missing ownership date: ${text}`);
  const month =
    ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(
      (match[2] ?? '').toUpperCase(),
    ) + 1;
  return date(`${match[3]}-${String(month).padStart(2, '0')}-${(match[1] ?? '').padStart(2, '0')}`);
}
export function parseFivePct(bytes: Uint8Array) {
  return parseFiveRows(readSheet(bytes));
}

export async function parseFivePctPdf(bytes: Uint8Array) {
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const { OPS } = await getResolvedPDFJS();
  const sheet: string[][] = [];
  const groups: { ticker: string; rows: string[][]; fields: string[]; open: boolean }[] = [];
  let previousSegment = '';
  const matrix = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]);
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const cells = content.items.flatMap((item) => {
      if (!('str' in item) || !item.str.trim()) return [];
      const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      return [{ text: item.str.trim(), x, y, width: item.width }];
    });
    const dates = cells.filter((c) => /^Kepemilikan Per /i.test(c.text)).sort((a, b) => a.x - b.x);
    if (!dates.length) {
      page.cleanup();
      continue;
    }
    if (dates.length !== 2) throw new Error('Unsupported legacy 5% date columns');
    const previous = headerDate(dates[0]?.text ?? '');
    const current = headerDate(dates[1]?.text ?? '');
    if (!sheet.length) {
      const header: string[] = [];
      header[1] = 'Kode Efek';
      header[11] = dates[0]?.text ?? '';
      header[14] = dates[1]?.text ?? '';
      sheet.push(header, []);
    } else if (
      headerDate(sheet[0]?.[11] ?? '') !== previous ||
      headerDate(sheet[0]?.[14] ?? '') !== current
    )
      throw new Error('Mixed legacy 5% snapshot dates');

    const operators = await page.getOperatorList();
    let transform: z.infer<typeof matrix> = [1, 0, 0, 1, 0, 0];
    type Clip = { left: number; right: number; top: number; bottom: number };
    let clip: Clip | undefined;
    let pendingClip = false;
    const stack: {
      transform: z.infer<typeof matrix>;
      fontSize: number;
      charSpacing: number;
      clip: Clip | undefined;
    }[] = [];
    let textMatrix: z.infer<typeof matrix> = [1, 0, 0, 1, 0, 0];
    let fontSize = 0;
    let charSpacing = 0;
    let cursor = 0;
    const glyphs = z.array(
      z.union([z.number(), z.object({ unicode: z.string(), width: z.number() })]),
    );
    const letters: { text: string; x: number; y: number; width: number }[] = [];
    const rectangles: { left: number; right: number; top: number; bottom: number }[] = [];
    for (const [i, op] of operators.fnArray.entries()) {
      if (op === OPS.save) stack.push({ transform, fontSize, charSpacing, clip });
      if (op === OPS.restore) {
        const saved = stack.pop();
        transform = matrix.parse(saved?.transform);
        fontSize = z.number().parse(saved?.fontSize);
        charSpacing = z.number().parse(saved?.charSpacing);
        clip = saved?.clip;
      }
      if (op === OPS.transform) {
        const [a, b, c, d, e, f] = transform;
        const [g, h, j, k, l, m] = matrix.parse(operators.argsArray[i]);
        transform = [
          a * g + c * h,
          b * g + d * h,
          a * j + c * k,
          b * j + d * k,
          a * l + c * m + e,
          b * l + d * m + f,
        ];
      }
      if (op === OPS.setFont) fontSize = z.number().parse(operators.argsArray[i]?.[1]);
      if (op === OPS.setCharSpacing) charSpacing = z.number().parse(operators.argsArray[i]?.[0]);
      if (op === OPS.eoClip || op === OPS.clip) pendingClip = true;
      if (op === OPS.constructPath && operators.argsArray[i]?.[0] === OPS.endPath && pendingClip) {
        const [x1, y1, x2, y2] = z
          .tuple([z.number(), z.number(), z.number(), z.number()])
          .parse(Array.from(operators.argsArray[i]?.[2]));
        const [a, b, c, d, e, f] = transform;
        const p = viewport.convertToViewportPoint(a * x1 + c * y1 + e, b * x1 + d * y1 + f);
        const q = viewport.convertToViewportPoint(a * x2 + c * y2 + e, b * x2 + d * y2 + f);
        clip = {
          left: Math.max(Math.min(p[0], q[0]), clip?.left ?? -Infinity),
          right: Math.min(Math.max(p[0], q[0]), clip?.right ?? Infinity),
          top: Math.max(Math.min(p[1], q[1]), clip?.top ?? -Infinity),
          bottom: Math.min(Math.max(p[1], q[1]), clip?.bottom ?? Infinity),
        };
        pendingClip = false;
      }
      if (op === OPS.setTextMatrix) {
        textMatrix = matrix.parse(Array.from(operators.argsArray[i]?.[0]));
        cursor = 0;
      }
      if (op === OPS.showText) {
        const [a, b, c, d, e, f] = transform;
        const point = (offset: number) => {
          const x = textMatrix[0] * offset + textMatrix[4];
          const y = textMatrix[1] * offset + textMatrix[5];
          return viewport.convertToViewportPoint(a * x + c * y + e, b * x + d * y + f);
        };
        for (const glyph of glyphs.parse(operators.argsArray[i]?.[0])) {
          if (typeof glyph === 'number') {
            cursor -= (glyph * fontSize) / 1000;
            continue;
          }
          const p = point(cursor);
          cursor += (glyph.width * fontSize) / 1000 + charSpacing;
          const q = point(cursor);
          if (
            !clip ||
            (p[1] >= clip.top && p[1] <= clip.bottom && p[0] <= clip.right && q[0] >= clip.left)
          )
            letters.push({ text: glyph.unicode, x: p[0], y: p[1], width: q[0] - p[0] });
        }
      }
      if (op !== OPS.constructPath || operators.argsArray[i]?.[0] === OPS.endPath) continue;
      const [a, b, c, d, e, f] = transform;
      const paths: unknown = operators.argsArray[i]?.[1];
      if (!Array.isArray(paths)) throw new Error('Unsupported legacy 5% table paths');
      for (const raw of paths) {
        if (!(raw instanceof Float32Array)) throw new Error('Unsupported legacy 5% table path');
        for (let j = 0; j < raw.length; j += 13) {
          if (
            raw[j] !== 0 ||
            raw[j + 3] !== 1 ||
            raw[j + 6] !== 1 ||
            raw[j + 9] !== 1 ||
            raw[j + 12] !== 4
          )
            throw new Error('Unsupported legacy 5% table rectangle');
          const x1 = raw[j + 1] ?? NaN;
          const y1 = raw[j + 2] ?? NaN;
          const x2 = raw[j + 7] ?? NaN;
          const y2 = raw[j + 8] ?? NaN;
          const p = viewport.convertToViewportPoint(a * x1 + c * y1 + e, b * x1 + d * y1 + f);
          const q = viewport.convertToViewportPoint(a * x2 + c * y2 + e, b * x2 + d * y2 + f);
          rectangles.push({
            left: Math.min(p[0], q[0]),
            right: Math.max(p[0], q[0]),
            top: Math.min(p[1], q[1]),
            bottom: Math.max(p[1], q[1]),
          });
        }
      }
    }
    const columns = rectangles
      .filter((r) => r.right - r.left < 1 && r.bottom - r.top > 50)
      .map((r) => (r.left + r.right) / 2)
      .sort((x, y) => x - y)
      .filter((x, i, all) => i === 0 || x - (all[i - 1] ?? 0) > 1);
    if (columns.length !== 19) throw new Error(`Unsupported legacy 5% columns: ${columns.length}`);
    const byColumn = columns
      .slice(0, -1)
      .map((left, i) =>
        letters.filter((item) => item.x >= left && item.x < (columns[i + 1] ?? NaN)),
      );
    function cell(column: number, y: number) {
      const left = columns[column] ?? NaN;
      const right = columns[column + 1] ?? NaN;
      const center = (left + right) / 2;
      const lines = rectangles
        .filter((r) => r.bottom - r.top < 1 && r.left < center && r.right > center)
        .map((r) => (r.top + r.bottom) / 2)
        .sort((x, y) => x - y);
      const upper = lines.filter((line) => line < y).at(-1);
      const lower = lines.find((line) => line > y);
      const top = upper ?? Math.min(...rectangles.map((r) => r.top));
      const bottom = lower ?? Math.max(...rectangles.map((r) => r.bottom));
      if (!(top < y && y < bottom))
        throw new Error(`Unbounded legacy 5% cell: page ${n}, column ${column}, row ${y}`);
      const contents = (byColumn[column] ?? [])
        .filter((item) => item.y > top && item.y < bottom)
        .sort((x, y) => x.y - y.y || x.x - y.x);
      let text = '';
      for (const [i, item] of contents.entries()) {
        const previous = contents[i - 1];
        if (previous && (item.y - previous.y > 0.3 || item.x - previous.x - previous.width > 0.2))
          text += ' ';
        text += item.text;
      }
      return { top, bottom, open: lower === undefined, text: text.trim() };
    }
    const tickers = cells.filter(
      (item) =>
        item.x > (columns[1] ?? NaN) &&
        item.x < (columns[2] ?? NaN) &&
        /^[A-Z0-9-]{2,12}$/.test(item.text),
    );
    for (const ticker of tickers) {
      const row = Array.from({ length: 18 }, (_, column) => cell(column, ticker.y).text);
      const root = cell(4, ticker.y);
      const segment = `${n}/${root.top}/${root.bottom}`;
      let group = groups.at(-1);
      if (segment !== previousSegment) {
        if (!group?.open) {
          group = { ticker: ticker.text, rows: [], fields: [], open: root.open };
          groups.push(group);
        }
        if (group.ticker !== ticker.text) throw new Error('Legacy 5% investor crosses tickers');
        for (const column of [0, 2, 4, 12, 13, 15, 16]) {
          const text = row[column];
          if (!text) continue;
          if (group.fields[column] && group.fields[column] !== text)
            throw new Error(`Conflicting legacy 5% investor field: ${column}`);
          group.fields[column] = text;
        }
        group.open = root.open;
        previousSegment = segment;
      }
      if (!group) throw new Error('Missing legacy 5% investor group');
      for (const column of [11, 14])
        if (!row[column]) throw new Error('Missing legacy 5% ownership number');
      group.rows.push(row);
    }
    page.cleanup();
  }
  if (!groups.length || groups.at(-1)?.open) throw new Error('Incomplete legacy 5% table');
  for (const group of groups) {
    for (const column of [2, 4, 12, 13, 15, 16])
      if (!group.fields[column]) throw new Error(`Missing legacy 5% investor field: ${column}`);
    for (const [i, row] of group.rows.entries()) {
      row[4] = '';
      if (i === 0)
        for (const column of [2, 4, 12, 13, 15, 16]) row[column] = group.fields[column] ?? '';
      sheet.push(row);
    }
  }
  return parseFiveRows(sheet);
}

function parseFiveRows(sheet: string[][]) {
  const header = sheet.findIndex((r) => r[1] === 'Kode Efek');
  if (header < 0) throw new Error('Missing 5% headers');
  const previousDate = headerDate(sheet[header]?.[11] ?? '');
  const asOf = headerDate(sheet[header]?.[14] ?? '');
  const groups: {
    holding: FiveHolding;
    previousCombined: number;
    previousPercent: number;
    accounts: {
      holderName: string;
      accountName: string;
      previousShares: number;
      currentShares: number;
    }[];
  }[] = [];
  let group: (typeof groups)[number] | undefined;
  for (const r of sheet.slice(header + 2)) {
    if (!r[3]?.trim() && !r[4]?.trim()) continue;
    if (r[4]?.trim()) {
      group = {
        holding: fiveHolding.parse({
          ticker: r[1]?.trim(),
          investorName: r[4].trim(),
          issuerName: r[2]?.trim(),
          asOf,
          combinedShares: number(r[15] ?? ''),
          percent: number(r[16] ?? ''),
          localForeign: r[10]?.trim() ?? '',
          nationality: r[8]?.trim() || undefined,
          domicile: r[9]?.trim() || undefined,
          accounts: [],
        }),
        previousCombined: number(r[12] ?? ''),
        previousPercent: number(r[13] ?? ''),
        accounts: [],
      };
      groups.push(group);
    }
    if (!group) throw new Error('Account without investor');
    const account = {
      holderName: r[3]?.trim() ?? '',
      accountName: r[5]?.trim() ?? '',
      previousShares: number(r[11] ?? ''),
      currentShares: number(r[14] ?? ''),
    };
    group.accounts.push(account);
    group.holding.accounts.push({
      holderName: account.holderName,
      accountName: account.accountName,
      shares: account.currentShares,
    });
  }
  const merged = new Map<string, (typeof groups)[number]>();
  for (const group of groups) {
    const key = JSON.stringify([group.holding.ticker, group.holding.investorName]);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, group);
      continue;
    }
    existing.holding.combinedShares += group.holding.combinedShares;
    existing.holding.percent =
      Math.round((existing.holding.percent + group.holding.percent) * 100) / 100;
    existing.previousCombined += group.previousCombined;
    existing.previousPercent =
      Math.round((existing.previousPercent + group.previousPercent) * 100) / 100;
    existing.holding.accounts.push(...group.holding.accounts);
    existing.accounts.push(...group.accounts);
  }
  return { asOf, previousDate, groups: [...merged.values()] };
}
