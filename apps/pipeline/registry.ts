import { getDocumentProxy, getResolvedPDFJS } from 'unpdf';
import { z } from 'zod';

export const registryParserVersion = 1;

const categories = [
  'Bank',
  'Government',
  'Private Equity',
  'Trustee Bank',
  'Venture Capital',
  'Private Bank',
  'Exchange Traded Funds',
  'Investment Manager',
  'Investment Advisors',
  'Brokerage Firms',
  'Hedge Fund',
  'Sovereign Wealth Fund',
  'Capital Market Supporting Institutions and Professions',
  'Commanditaire Vennootschap (CV) or Limited partnership',
  'Firm',
  'Invesment Fund Selling Agent',
  'Peer to peer lending',
  'Permanent establishment',
  'Sole proprietorship',
  'Corporate',
  'Association/social organization',
  'State-owned enterprises',
  'Central Bank',
  'State Owned Company',
  'Diocese',
  'Conference',
  'Congregation',
  'Cooperatives',
  'International organization',
  'Political parties',
  'Partnership',
  'Educational Institution',
  'Mutual Funds (MF)',
  'Securities Company (SC)',
  'Pension Funds (PF)',
  'Financial Institutional (IB)',
  'Insurance (IS)',
  'Foundation (FD)',
  'Individual (ID)',
];
type Cell = { text: string; x: number; y: number; width: number };
const center = (cell: Cell) => cell.x + cell.width / 2;
const integer = (text: string) =>
  /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)$/.test(text) &&
  Number.isSafeInteger(Number(text.replaceAll('.', '')))
    ? Number(text.replaceAll('.', ''))
    : null;
const percentage = (text: string) => {
  if (!/^\d{1,3}(?:[,.]\d{1,4})?%?$/.test(text)) return null;
  const value = Number(text.replace('%', '').replace(',', '.'));
  return value <= 100 ? value : null;
};

// Coordinates are in the rotated page's displayed axes. Text extraction order is not row order.
export async function parseRegistryLayout(bytes: Uint8Array) {
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const { OPS } = await getResolvedPDFJS();
  const glyphs = z.array(z.object({ unicode: z.string(), width: z.number() }));
  const pages: Cell[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const operators = await page.getOperatorList();
    const runs = new Map<string, number>();
    for (const [i, op] of operators.fnArray.entries()) {
      if (op !== OPS.showText) continue;
      const parsed = glyphs.safeParse(operators.argsArray[i]?.[0]);
      if (!parsed.success) continue;
      runs.set(
        parsed.data.map((g) => g.unicode).join(''),
        parsed.data.reduce((sum, g) => sum + g.width, 0),
      );
    }
    const cells: Cell[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      const text = item.str.trim();
      // PDF.js can merge adjacent cells (for example a holder name and its address).
      // Split only at an exact pair of source text runs, using their font widths.
      const split =
        !runs.has(text) &&
        [...runs.keys()].find(
          (run) => text.startsWith(`${run} `) && runs.has(text.slice(run.length + 1)),
        );
      if (split) {
        const suffix = text.slice(split.length + 1);
        const width = ((runs.get(suffix) ?? 0) * item.height) / 1000;
        cells.push(
          { text: split, x, y, width: ((runs.get(split) ?? 0) * item.height) / 1000 },
          { text: suffix, x: x + item.width - width, y, width },
        );
      } else cells.push({ text, x, y, width: item.width });
    }
    if (cells.some((c) => c.text === 'Letter / Announcement No.')) break;
    pages.push(cells);
    page.cleanup();
  }
  const gaps: string[] = [];
  function gap(field: string) {
    gaps.push(`Registry ${field}: unsupported or missing labeled cells`);
  }
  const floatPages = pages.filter((cells) =>
    cells.some((c) => c.text === 'Informasi Saham Free Float'),
  );
  const floatCells = floatPages.length === 1 ? (floatPages[0] ?? []) : [];
  const previous = floatCells.find((c) => c.text === 'Bulan Sebelumnya');
  const current = floatCells.find((c) => c.text === 'Bulan Ini');
  function floatValue(label: string, field: string, pct = false) {
    const labels = floatCells.filter((c) => c.text === label);
    const row = labels[0];
    if (labels.length === 1 && row && previous && current && center(current) > center(previous)) {
      const cells = floatCells.filter(
        (c) => c.x > (center(previous) + center(current)) / 2 && c.y > row.y - 4 && c.y < row.y + 4,
      );
      if (cells.length === 1 && cells[0]) {
        const value = pct ? percentage(cells[0].text) : integer(cells[0].text);
        if (value !== null) return value;
      }
    }
    gap(field);
    return null;
  }
  const free_float_pct = floatValue('% Saham Free Float', 'free float percentage', true);
  const total_shares = floatValue('Jumlah saham tercatat di Bursa per akhir bulan', 'total shares');
  const free_float_shares = floatValue('Jumlah saham Free Float', 'free float shares');
  let sid_count: number | null = null;
  for (const cells of pages) {
    const title = cells.find((c) => c.text === 'Jumlah Pemegang Saham Nasabah Pemilik SID');
    if (!title) continue;
    const headers = ['Bulan Sebelumnya', 'Bulan Sekarang', 'Perubahan'].map((label) =>
      cells.find((c) => c.text === label && c.y > title.y && c.y < title.y + 50),
    );
    const [before, now, change] = headers;
    if (
      !before ||
      !now ||
      !change ||
      Math.abs(before.y - now.y) > 2 ||
      Math.abs(now.y - change.y) > 2 ||
      !(before.x < now.x && now.x < change.x)
    )
      continue;
    const numbers = cells.filter(
      (c) =>
        c.y > now.y + 5 &&
        c.y < now.y + 40 &&
        c.x > (center(before) + center(now)) / 2 &&
        c.x < (center(now) + center(change)) / 2,
    );
    if (numbers.length === 1 && numbers[0]) sid_count = integer(numbers[0].text);
  }
  if (sid_count === null) gap('SID count');
  const investor_types: { label: string; shares: number | null; page: number | null }[] = [];
  const kseiStart = pages.findIndex((cells) =>
    cells.some(
      (c) =>
        c.text === 'Jumlah Saham Scripless berdasarkan Tipe dan Klasifikasi Investor dari KSEI',
    ),
  );
  if (kseiStart < 0) gap('investor types');
  for (const label of kseiStart < 0 ? [] : categories) {
    const matches = pages.flatMap((cells, index) => {
      if (index < kseiStart || kseiStart < 0) return [];
      const heading = cells.find(
        (c) =>
          c.text === 'Jumlah Saham Scripless berdasarkan Tipe dan Klasifikasi Investor dari KSEI',
      );
      return cells
        .filter((c) => c.text === label && c.x < 80 && (!heading || c.y > heading.y))
        .map((cell) => ({ cell, cells, page: index + 1 }));
    });
    const match = matches[0];
    if (matches.length !== 1 || !match) {
      gap(`investor type ${label}`);
      investor_types.push({ label, shares: null, page: null });
      continue;
    }
    const values = match.cells.filter(
      (c) => c.x > 340 && c.x + c.width < 490 && Math.abs(c.y - match.cell.y) < 4,
    );
    const value = values.length === 1 ? values[0] : undefined;
    const shares = value ? integer(value.text) : null;
    if (!value || (shares === null && value.text !== '-')) gap(`investor type ${label}`);
    investor_types.push({ label, shares, page: match.page });
  }
  const holders: {
    investor: string;
    pct: number;
    controller: boolean | null;
    controller_affiliate: boolean | null;
    page: number;
  }[] = [];
  for (const [index, cells] of pages.entries()) {
    for (const name of cells.filter((c) => c.text === 'Nama')) {
      const address = cells.find((c) => c.text === 'Alamat' && Math.abs(c.y - name.y) < 2);
      const controller = cells.find((c) => c.text === 'Pengendali' && Math.abs(c.y - name.y) < 2);
      const affiliate = cells.find((c) => c.text === 'Afiliasi' && Math.abs(c.y - name.y) < 9);
      if (!address || !controller || !affiliate || controller.x >= affiliate.x) continue;
      const end = Math.min(
        ...cells.filter((c) => c.text === 'Nama' && c.y > name.y).map((c) => c.y - 22),
        ...cells
          .filter((c) => /^Pemegang Saham < 5%$/.test(c.text) && c.y > name.y)
          .map((c) => c.y - 5),
        590,
      );
      // Current stake is the last percentage column before the two relationship columns.
      const stakes = cells
        .filter(
          (c) =>
            /^\d+(?:[,.]\d+)?%$/.test(c.text) &&
            center(c) > controller.x - 65 &&
            center(c) < controller.x &&
            c.y > name.y + 15 &&
            c.y < end,
        )
        .sort((a, b) => a.y - b.y);
      for (const [i, stake] of stakes.entries()) {
        const next = stakes[i + 1]?.y ?? end;
        const row = cells.filter((c) => c.y >= stake.y - 2 && c.y < next - 2);
        const names = row
          .filter((c) => Math.abs(center(c) - center(name)) < 22)
          .sort((a, b) => a.y - b.y);
        const investor = names.map((c) => c.text).join(' ');
        const pct = percentage(stake.text);
        if (!investor || pct === null) {
          gap('holder row');
          continue;
        }
        const flag = (header: Cell, field: string) => {
          const marks = row.filter((c) => Math.abs(center(c) - center(header)) < 18);
          if (!marks.length) return null;
          if (marks.length === 1 && marks[0]?.text === 'X') return true;
          gap(`holder ${investor} ${field}`);
          return null;
        };
        holders.push({
          investor,
          pct,
          controller: flag(controller, 'controller'),
          controller_affiliate: flag(affiliate, 'controller affiliate'),
          page: index + 1,
        });
      }
    }
  }
  if (!holders.length) gap('holder flags');
  return {
    free_float_pct,
    total_shares,
    free_float_shares,
    sid_count,
    investor_types,
    holders,
    gaps,
  };
}
