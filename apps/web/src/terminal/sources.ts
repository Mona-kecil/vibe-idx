import { z } from 'zod';
import { load, loadNews, corporateActionSchema, riskSchema } from '../data';
import { brokerHistorySchema, brokerTickerSchema } from '../brokers';
import { headlineSchema, calendarEventSchema } from './contracts';

export type Resource<T> =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; data: T };
export type Headline = z.infer<typeof headlineSchema>;
export type Risk = z.infer<typeof riskSchema>;
const publication = {
  as_of: z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value)))
    .nullable()
    .optional(),
  errors: z.array(z.string()).default([]),
};
const newsRows = z.array(headlineSchema);
const calendarRows = z.array(calendarEventSchema);
const date = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const httpUrl = z.url().refine((value) => /^https?:/.test(value));
const actionRows = z.array(
  corporateActionSchema.extend({
    amount: z.number().nullable().optional(),
    steps: z.array(corporateActionSchema.shape.steps.element.extend({ date })),
  }),
);
const riskRows = z.record(
  z.string(),
  riskSchema.extend({
    susp: riskSchema.shape.susp.unwrap().extend({ since: date, url: httpUrl }).nullable(),
    uma: riskSchema.shape.uma.unwrap().extend({ date, url: httpUrl }).nullable(),
  }),
);
const newsSchema = z.union([
  z.object({ ...publication, news: newsRows }),
  newsRows.transform((news) => ({ news, errors: [], as_of: undefined })),
]);
const calendarSchema = z.union([
  z.object({ ...publication, cal: calendarRows }),
  calendarRows.transform((cal) => ({ cal, errors: [], as_of: undefined })),
]);
const actionsSchema = z.union([
  z.object({ ...publication, actions: actionRows }),
  actionRows.transform((actions) => ({ actions, errors: [], as_of: undefined })),
]);
const risksSchema = z.union([
  z.object({ ...publication, asof: date.nullable().optional(), risk: riskRows }),
  riskRows.transform((risk) => ({ risk, errors: [], as_of: undefined, asof: undefined })),
]);

async function published<T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<Resource<T>> {
  try {
    const response = await fetch(`/data/${path}`, { signal });
    if (!response.ok) return { kind: 'unavailable' };
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? { kind: 'ready', data: parsed.data } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
export const fetchHeadlines = (signal?: AbortSignal) => published('news.json', newsSchema, signal);
export const fetchCalendar = (signal?: AbortSignal) =>
  published('calendar.json', calendarSchema, signal);
export const fetchActions = (signal?: AbortSignal) =>
  published('corporate-actions.json', actionsSchema, signal);
export const fetchRisk = (signal?: AbortSignal) => published('risk.json', risksSchema, signal);
export async function terminalData() {
  const [stocks, market, health, feed, summary] = await Promise.all([
    load('tickers.json'),
    load('market.json'),
    load('health.json'),
    load('feed.json'),
    load('market-summary.json'),
  ]);
  return { stocks, market, health, feed, summary };
}
export type TerminalData = Awaited<ReturnType<typeof terminalData>>;
export async function fetchDetail(ticker: string) {
  return load(`ticker/${brokerTickerSchema.parse(ticker)}.json`);
}
export async function fetchBrokers(ticker: string, token: string, signal?: AbortSignal) {
  const response = await fetch(`/api/brokers?ticker=${encodeURIComponent(ticker)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal,
  });
  if (response.status === 401) throw new Error('Your session expired. Sign in again.');
  if (response.status === 404) return [];
  if (!response.ok) throw new Error('Broker data is unavailable. Retry to load summaries.');
  const history = brokerHistorySchema.parse(await response.json());
  if (history.ticker !== ticker) throw new Error('Broker ticker mismatch.');
  return history.days;
}

export async function fetchTickerNews(ticker: string): Promise<Resource<Headline[]>> {
  try {
    const rows = await loadNews(ticker);
    return {
      kind: 'ready',
      data: rows.map((row) => ({
        ts: row.published_at,
        src: row.source,
        title: row.title,
        link: row.url,
        region: 'TICKER',
        sum: '',
        tags: [ticker],
      })),
    };
  } catch {
    return { kind: 'unavailable' };
  }
}
