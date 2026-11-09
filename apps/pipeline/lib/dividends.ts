import { getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import type { corporateActionSchema } from '../../web/src/data';
import type { parseAnnouncements } from '../reports';
import type { Download } from './idx-response';

type Action = z.infer<typeof corporateActionSchema>;
type Step = Action['steps'][number];
type Disclosure = Pick<
  ReturnType<typeof parseAnnouncements>['disclosures'][number],
  'ticker' | 'title' | 'published_at' | 'attachments'
>;
type Cell = { text: string; x: number; y: number; width: number };
const months = [
  ['januari', 'january'],
  ['februari', 'february'],
  ['maret', 'march'],
  ['april'],
  ['mei', 'may'],
  ['juni', 'june'],
  ['juli', 'july'],
  ['agustus', 'august'],
  ['september'],
  ['oktober', 'october'],
  ['november'],
  ['desember', 'december'],
];
const currency = '(IDR|Rp\\.?|USD|US\\$|SGD|S\\$|AUD|A\\$|EUR|JPY|HKD|HK\\$)';
const digits = '(\\d+(?:[.,]\\d+)*)';
const money = new RegExp(`^${currency}\\s*${digits}(?:,-)?$`, 'i');
const perShare = new RegExp(
  `${currency}\\s*${digits}(?:,-)?(?:\\s*\\([^)]{0,160}\\))?\\s*(?:per|setiap|untuk setiap)\\s*(?:lembar\\s+)?(saham|share)`,
  'gi',
);

function amount(code: string, number: string, english = false) {
  const currency = /^rp/i.test(code)
    ? 'IDR'
    : ({ US$: 'USD', S$: 'SGD', A$: 'AUD', HK$: 'HKD' }[code.toUpperCase()] ?? code.toUpperCase());
  const format = english
    ? /^(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?$/
    : /^(?:\d+|[1-9]\d{0,2}(?:\.\d{3})+)(?:,\d+)?$/;
  if (!format.test(number)) return null;
  const value = Number(
    english ? number.replaceAll(',', '') : number.replaceAll('.', '').replace(',', '.'),
  );
  return Number.isFinite(value) && value > 0 ? { value, currency } : null;
}

function day(text: string) {
  const m = /\b(\d{1,2})\s+([a-z]+)\s+(20\d{2})\b/i.exec(text);
  if (!m) return null;
  const month = months.findIndex((names) => names.includes(m[2]!.toLowerCase())) + 1;
  const date = `${m[3]}-${String(month).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return z.iso.date().safeParse(date).success ? date : null;
}

function step(text: string): Step['step'] | null {
  if (/^(?:(?:Tanggal )?cum dividen|Dividend cum date)/i.test(text) && /regul/i.test(text))
    return 'cum';
  if (/^(?:(?:Tanggal )?ex dividen|Dividend ex date)/i.test(text) && /regul/i.test(text))
    return 'ex';
  if (/^(?:Tanggal (?:Daftar Pemegang Saham|DPS)|Recording date)/i.test(text)) return 'record';
  if (/^(?:Tanggal Pembayaran Dividen|Pembayaran dividen|Dividend payment date)/i.test(text))
    return 'pay';
  return null;
}

export async function readDividend(bytes: Uint8Array) {
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const amounts: NonNullable<Action['amount']>[] = [];
  const dates = new Map<Step['step'], string>();
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const cells: Cell[] = content.items.flatMap((item) => {
      if (!('str' in item) || !item.str.trim()) return [];
      const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      return [{ text: item.str.trim(), x, y, width: item.width }];
    });
    const english = cells.some((c) => c.text === 'Go To Indonesian Page');
    if (english) break;
    for (const label of cells) {
      const right = cells
        .filter((c) => c.x >= label.x + label.width - 1 && Math.abs(c.y - label.y) < 3)
        .sort((a, b) => a.x - b.x)
        .map((c) => c.text)
        .join(' ');
      if (/^Dividen per saham(?:\s*\(|$)/i.test(label.text)) {
        const m = money.exec(right);
        const parsed = m && amount(m[1]!, m[2]!);
        if (parsed) amounts.push(parsed);
      }
      const kind = step(`${label.text} ${right}`);
      const date = kind && day(`${label.text} ${right}`);
      if (kind && date) dates.set(kind, date);
    }
    const text = cells
      .map((c) => c.text)
      .join(' ')
      .replace(/\s+/g, ' ');
    for (const m of text.matchAll(perShare)) {
      const parsed = amount(m[1]!, m[2]!, m[3]!.toLowerCase() === 'share');
      if (parsed) amounts.push(parsed);
    }
    page.cleanup();
  }
  const unique = new Map(amounts.map((a) => [`${a.currency}|${a.value}`, a]));
  return {
    amount: unique.size === 1 ? [...unique.values()][0]! : null,
    steps: [...dates].map(([step, date]) => ({ step, date })),
  };
}

function matches(action: Action, steps: Step[]) {
  const shared = steps.filter((s) => action.steps.some((a) => a.step === s.step));
  return (
    shared.every((s) =>
      action.steps.some((a) => a.step === s.step && a.date.slice(0, 10) === s.date),
    ) &&
    (shared.some((s) => s.step === 'pay' || s.step === 'record') || shared.length >= 2)
  );
}

export async function dividendAmounts(
  actions: Action[],
  disclosures: Disclosure[],
  download: Download,
) {
  const errors: Error[] = [];
  const candidates = disclosures
    .filter(
      (d) =>
        /dividen/i.test(d.title) &&
        /jadwal|pembagian|pembayaran|pengumuman|aksi korporasi/i.test(d.title) &&
        !/bukti iklan/i.test(d.title),
    )
    .sort((a, b) => b.published_at.localeCompare(a.published_at));
  const reads = new Map<string, Promise<Awaited<ReturnType<typeof readDividend>> | null>>();
  const read = (url: string) => {
    let result = reads.get(url);
    if (!result) {
      result = download(url)
        .then(readDividend)
        .catch((cause: unknown) => {
          errors.push(new Error(`Dividend announcement ${url}`, { cause }));
          return null;
        });
      reads.set(url, result);
    }
    return result;
  };
  for (const action of actions) {
    action.amount = null;
    if (action.kind !== 'DIV' || action.label === 'Stock dividend') continue;
    for (const d of candidates.filter((d) => d.ticker === action.ticker)) {
      let schedule: Step[] = [];
      let matched = false;
      for (const attachment of d.attachments) {
        if (!/\.pdf$/i.test(new URL(attachment.url).pathname)) continue;
        const result = await read(attachment.url);
        if (!result) continue;
        if (result.steps.some((s) => schedule.some((a) => a.step === s.step && a.date !== s.date)))
          continue;
        schedule = [...new Map([...schedule, ...result.steps].map((s) => [s.step, s])).values()];
        if (!matches(action, schedule)) continue;
        matched = true;
        action.steps = [
          ...action.steps,
          ...schedule.filter((s) => !action.steps.some((a) => a.step === s.step)),
        ].sort((a, b) => a.date.localeCompare(b.date));
        if (result.amount) {
          action.amount = result.amount;
          break;
        }
      }
      if (matched) break;
    }
  }
  return { actions, errors };
}
