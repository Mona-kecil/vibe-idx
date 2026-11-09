import { z } from 'zod';
import type { riskSchema } from '../../web/src/data';
import { decode, type Download, ymd } from './idx-response';

type Risk = z.infer<typeof riskSchema>;

const notationSchema = z.object({
  ResultCount: z.number(),
  Results: z.array(
    z.object({
      EmitenCode: z.string(),
      Notation: z.string(),
      Date: z.string(),
      Description: z.string(),
    }),
  ),
});
const suspensionSchema = z.object({
  ResultCount: z.number(),
  Results: z.array(
    z.object({
      Judul: z.string(),
      Kode: z.string(),
      Date: z.string(),
      Info_Type: z.enum(['SPT', 'UPT']),
      Data_Download: z.string(),
    }),
  ),
});
const umaSchema = z.object({
  ResultCount: z.number(),
  Results: z.array(
    z.object({
      CompanyID: z.string(),
      UMADate: z.string(),
      Attachment: z.string(),
      Judul: z.string(),
    }),
  ),
});
type Notice = {
  date: string;
  type: 'SPT' | 'UPT';
  reason: string | null;
  url: string;
  codes: string[];
};

export function notations(description: string) {
  return description.split('|').flatMap((part) => {
    const m = part.match(/^\s*([A-Z])\s*:\s*(.+?)\s*$/s);
    return m ? [{ code: m[1]!, text: m[2]!.replace(/\s+/g, ' ') }] : [];
  });
}

export function activeSuspensions(notices: Notice[]) {
  const state = new Map<string, Notice | null>();
  for (const n of [...notices].sort((a, b) => a.date.localeCompare(b.date)))
    for (const code of n.codes) state.set(code, n.type === 'SPT' ? n : null);
  return new Map([...state].filter((e): e is [string, Notice] => e[1] !== null));
}

export async function fetchRisk(
  stocks: Set<string>,
  published: Record<string, { codes: string[]; reason: string | null }>,
  download: Download,
  { now = new Date() } = {},
) {
  const errors: string[] = [];
  const umaFrom = ymd(new Date(now.getTime() - 30 * 864e5));
  const [notes, suspensions, umas] = await Promise.all([
    download('/primary/ListedCompany/GetSpecialNotation?indexfrom=0&pagesize=3000').then((bytes) =>
      notationSchema.parse(decode(bytes)),
    ),
    download('/primary/NewsAnnouncement/GetSuspension?pageNumber=1&pageSize=5000').then((bytes) =>
      suspensionSchema.parse(decode(bytes)),
    ),
    download(
      `/primary/NewsAnnouncement/GetUma?pageNumber=1&pageSize=1000&dateFrom=${umaFrom}&dateTo=${ymd(now)}`,
    ).then((bytes) => umaSchema.parse(decode(bytes))),
  ]);
  for (const [name, data] of [
    ['notation', notes],
    ['suspension', suspensions],
    ['UMA', umas],
  ] as const)
    if (data.ResultCount !== data.Results.length) throw new Error(`Incomplete IDX ${name} list`);

  const multi = suspensions.Results.filter((n) => n.Kode.includes('>'));
  const multiNotices = new Map(
    multi.flatMap((n) => {
      const notice = published[n.Data_Download];
      return notice
        ? [[n.Data_Download, { ...notice, codes: notice.codes.filter((c) => stocks.has(c)) }]]
        : [];
    }),
  );
  const unread = multi
    .filter((n) => !multiNotices.has(n.Data_Download))
    .map((n) => n.Date.slice(0, 10));
  if (unread.length)
    errors.push(
      `${unread.length} multi-stock suspension notice${unread.length > 1 ? 's' : ''} not read yet (${unread.sort().join(', ')})`,
    );
  const active = activeSuspensions(
    suspensions.Results.map((n) => ({
      date: n.Date.slice(0, 16),
      type: n.Info_Type,
      reason: multiNotices.get(n.Data_Download)?.reason ?? null,
      url: new URL(n.Data_Download, 'https://www.idx.co.id').toString(),
      codes: stocks.has(n.Kode.trim())
        ? [n.Kode.trim()]
        : (multiNotices.get(n.Data_Download)?.codes ?? []),
    })),
  );

  const risk: Record<string, Risk> = {};
  const entry = (t: string) => (risk[t] ??= { notes: [], susp: null, uma: null });
  for (const n of notes.Results) {
    const t = n.EmitenCode.trim();
    if (stocks.has(t)) {
      const parsed = notations(n.Description);
      if (parsed.length) entry(t).notes = parsed;
    }
  }
  for (const [t, n] of active) entry(t).susp = { since: n.date, reason: n.reason, url: n.url };
  for (const u of umas.Results.sort((a, b) => a.UMADate.localeCompare(b.UMADate))) {
    const t = u.CompanyID.trim();
    if (stocks.has(t))
      entry(t).uma = {
        date: u.UMADate.slice(0, 10),
        url: new URL(u.Attachment, 'https://www.idx.co.id').toString(),
      };
  }
  return { risk, errors };
}
