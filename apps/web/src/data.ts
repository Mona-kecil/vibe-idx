import { z } from 'zod';

export const healthSchema = z.object({
  prices: z.string().nullable(),
  indices: z.string().nullable(),
  five_pct: z.string().nullable(),
  one_pct: z.string().nullable().default(null),
  issuers: z.string().nullable(),
  run_at: z.string(),
});

export const marketSchema = z.object({
  date: z.string().nullable(),
  up: z.number(),
  down: z.number(),
  history: z.array(
    z.object({
      date: z.string(),
      close: z.number(),
      change: z.number().nullable(),
      change_pct: z.number().nullable(),
    }),
  ),
});

const ownershipChangeSchema = z.object({
  investor: z.string(),
  shares_before: z.number(),
  shares_after: z.number().nullable(),
  net_shares: z.number().nullable(),
  pct_before: z.number(),
  pct_after: z.number().nullable(),
});
const feedBase = z.object({ ticker: z.string(), date: z.string() });
export const feedSchema = z.array(
  z.discriminatedUnion('kind', [
    feedBase.extend({
      kind: z.literal('volume_spike'),
      numbers: z.object({
        volume: z.number(),
        avg_volume: z.number(),
        multiple: z.number(),
        value: z.number(),
        prior_days: z.number(),
      }),
    }),
    feedBase.extend({
      kind: z.literal('ara'),
      numbers: z.object({
        prev: z.number(),
        close: z.number(),
        change_pct: z.number(),
        band_pct: z.number(),
      }),
    }),
    feedBase.extend({
      kind: z.literal('foreign_streak'),
      numbers: z.object({ streak_days: z.number(), net_foreign: z.number() }),
    }),
    feedBase.extend({
      kind: z.literal('green_on_red'),
      numbers: z.object({
        change_pct: z.number(),
        market_change_pct: z.number(),
        value: z.number(),
      }),
    }),
    feedBase.extend({
      kind: z.literal('five_pct_change'),
      numbers: ownershipChangeSchema.extend({ previous_date: z.string() }),
    }),
  ]),
);

export const stocksSchema = z.array(
  z.object({
    ticker: z.string(),
    name: z.string(),
    close: z.number(),
    change_pct: z.number().nullable(),
    volume: z.number(),
    value: z.number(),
    net_foreign: z.number(),
  }),
);

export const tickerSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  prices: z.array(
    z.object({
      date: z.string(),
      close: z.number(),
      volume: z.number(),
      value: z.number(),
      net_foreign: z.number(),
    }),
  ),
  holders: z.array(z.object({ investor: z.string(), shares: z.number(), pct: z.number() })),
  changes: z.array(ownershipChangeSchema.extend({ date: z.string() })),
  one_pct: z
    .object({
      date: z.string().nullable(),
      holders: z.array(
        z.object({
          investor: z.string(),
          shares: z.number(),
          pct: z.number(),
          classification: z.string().nullable(),
          local_foreign: z.string().nullable(),
        }),
      ),
    })
    .default({ date: null, holders: [] }),
  disclosures: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        published_at: z.string(),
        url: z.url(),
        kind: z.enum(['insider', 'registry', 'other']),
        attachments: z.array(z.object({ name: z.string(), url: z.url() })),
      }),
    )
    .default([]),
  insiders: z
    .array(
      z.object({
        date: z.string(),
        reporter: z.string().nullable(),
        shares_before: z.number().nullable(),
        shares_after: z.number().nullable(),
        net_shares: z.number().nullable(),
        url: z.url(),
      }),
    )
    .default([]),
  registry: z
    .object({
      date: z.string(),
      free_float_pct: z.number().nullable(),
      total_shares: z.number().nullable(),
      sid_count: z.number().nullable(),
      url: z.url(),
    })
    .nullable()
    .default(null),
});

const newsSchema = z.array(
  z.object({
    title: z.string(),
    url: z.url(),
    published_at: z.string(),
    source: z.string(),
  }),
);

export async function loadNews(ticker: string) {
  const response = await fetch(`/api/news?ticker=${encodeURIComponent(ticker)}`);
  if (!response.ok) throw new Error('Could not load news');
  return newsSchema.parse(await response.json());
}

export type Health = z.infer<typeof healthSchema>;
export type Market = z.infer<typeof marketSchema>;
export type Feed = z.infer<typeof feedSchema>;
export type Stock = z.infer<typeof stocksSchema>[number];
export type Ticker = z.infer<typeof tickerSchema>;
export type OwnershipChange = z.infer<typeof ownershipChangeSchema>;

type TickerPath = `ticker/${string}.json`;
export function load(path: 'health.json'): Promise<Health>;
export function load(path: 'market.json'): Promise<Market>;
export function load(path: 'feed.json'): Promise<Feed>;
export function load(path: 'tickers.json'): Promise<Stock[]>;
export function load(path: TickerPath): Promise<Ticker | null>;
export async function load(
  path: 'health.json' | 'market.json' | 'feed.json' | 'tickers.json' | TickerPath,
) {
  const response = await fetch(`/data/${path}`);
  if (response.status === 404 && path.startsWith('ticker/')) return null;
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  const json: unknown = await response.json();
  switch (path) {
    case 'health.json':
      return healthSchema.parse(json);
    case 'market.json':
      return marketSchema.parse(json);
    case 'feed.json':
      return feedSchema.parse(json);
    case 'tickers.json':
      return stocksSchema.parse(json);
    default:
      return tickerSchema.parse(json);
  }
}
