import { extractText } from 'unpdf';
import { z } from 'zod';

const listSchema = z.object({
  ResultCount: z.number(),
  Results: z.array(z.object({ Kode: z.string(), Data_Download: z.string() })),
});

// Notices that suspend or resume several stocks list them only inside the PDF.
export function multiStockNotices(input: unknown) {
  const list = listSchema.parse(input);
  if (list.ResultCount !== list.Results.length) throw new Error('Incomplete IDX suspension list');
  return list.Results.filter((n) => n.Kode.includes('>')).map((n) => n.Data_Download);
}

export function noticeCodes(text: string) {
  const find = (re: RegExp) => [...new Set([...text.matchAll(re)].map((m) => m[1]!))];
  const listed = find(/(?:^|\n)\s*(?:\d{1,3}\.?\s+)?([A-Z]{4})\s+(?:PT\b|\S+.*Tbk)/g);
  const stated = text.match(/(?:there (?:are|is)|terdapat|sebanyak) (\d+)/i);
  const count = stated && Number(stated[1]);
  if (listed.length && count && listed.length < count)
    throw new Error(`Suspension notice lists ${listed.length} of ${count} codes`);
  const named = listed.length ? listed : find(/(?:\(“?|(?:Efek|Saham) )([A-Z]{4})(?=[”)\s,;.])/g);
  if (!named.length) throw new Error('Suspension notice names no securities');
  return named;
}

export function noticeReason(text: string) {
  const lines = text.split('\n').map((l) => l.trim());
  const start = lines.findIndex((l) => /^(ANNOUNCEMENT|PENGUMUMAN)$/i.test(l));
  const end = lines.findIndex((l, i) => i > start && /^No\.?\s/.test(l));
  if (start < 0 || end < 0) return null;
  const subject = lines.slice(start + 1, end);
  if (subject.length < 2) return null;
  return (
    subject
      .slice(1)
      .join(' ')
      .replace(/\s+No\.?:?\s.*$/, '')
      .replace(/\s+For Listed Companies.*$/i, '')
      .trim() || null
  );
}

export async function readNotice(bytes: Uint8Array) {
  const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
  return { codes: noticeCodes(text), reason: noticeReason(text) };
}
