import {
  tickBookSchema,
  tickTradesSchema,
  type TickBook,
  type TickKind,
  type TickTrades,
} from '../ticks';
import { z } from 'zod';
import { load, loadNews, corporateActionsSchema, risksSchema, riskSchema } from '../data';
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
const newsSchema = z.object({ ...publication, news: z.array(headlineSchema) });
const calendarSchema = z.object({ ...publication, cal: z.array(calendarEventSchema) });
const actionsSchema = corporateActionsSchema.transform((actions) => ({ actions }));
const risks = risksSchema.transform((risk) => ({ risk }));

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
export const fetchRisk = (signal?: AbortSignal) => published('risk.json', risks, signal);
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

export async function fetchTicks<K extends TickKind>(
  ticker: string,
  date: string,
  kind: K,
  token: string,
  signal?: AbortSignal,
): Promise<(K extends 'book' ? TickBook : TickTrades) | null> {
  const query = new URLSearchParams({ view: 'ticks', ticker, date, kind });
  const response = await fetch(`/api/brokers?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal,
  });
  if (response.status === 401) throw new Error('Your session expired. Sign in again.');
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Tick data is unavailable. Retry.');
  const parsed = (kind === 'book' ? tickBookSchema : tickTradesSchema).parse(await response.json());
  if (parsed.ticker !== ticker || parsed.date !== date) throw new Error('Tick data mismatch.');
  return parsed as K extends 'book' ? TickBook : TickTrades;
}
