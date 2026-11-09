import { z } from 'zod';

const healthSchema = z.object({
  prices: z.string().nullable(),
  indices: z.string().nullable(),
  five_pct: z.string().nullable(),
  one_pct: z.string().nullable().default(null),
  issuers: z.string().nullable(),
  disclosures: z.string().nullable().default(null),
  brokers: z.string().nullable().default(null),
  corporate_actions: z.string().nullable().default(null),
  risk: z.string().nullable().default(null),
  run_at: z.string(),
  failed: z.array(z.string()).default([]),
});

const marketSchema = z.object({
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

const marketWindowSchema = z.object({
  change_pct: z.number().nullable(),
  value: z.number().nullable(),
  rel_volume: z.number().nullable(),
});
const marketSummarySchema = z.object({
  date: z.iso.date().nullable(),
  stocks: z.array(
    z.object({
      ticker: z.string(),
      name: z.string(),
      close: z.number().nullable(),
      windows: z.object({
        '1d': marketWindowSchema,
        '3d': marketWindowSchema,
        '5d': marketWindowSchema,
      }),
    }),
  ),
});
export type MarketSummary = z.infer<typeof marketSummarySchema>;
export type MarketPeriod = keyof MarketSummary['stocks'][number]['windows'];

const ownershipChangeSchema = z.object({
  investor: z.string(),
  shares_before: z.number(),
  shares_after: z.number().nullable(),
  net_shares: z.number().nullable(),
  pct_before: z.number(),
  pct_after: z.number().nullable(),
  exited: z.boolean().optional(),
});
const feedBase = z.object({ ticker: z.string(), date: z.string() });
const knownFeedSchema = z.array(
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

const feedKinds: ReadonlySet<string> = new Set(
  knownFeedSchema.element.options.map((option) => option.shape.kind.value),
);
const feedSchema = z
  .array(z.object({ kind: z.string() }).passthrough())
  .transform((rows) => rows.filter((row) => feedKinds.has(row.kind)))
  .pipe(knownFeedSchema);

const stocksSchema = z.array(
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

const registrySchema = z.object({
  date: z.string(),
  free_float_pct: z.number().nullable(),
  issued_shares: z.number().nullable(),
  sid_count: z.number().nullable(),
  url: z.url(),
  free_float_shares: z.number().nullable().default(null),
  investor_types: z
    .array(
      z.object({ label: z.string(), shares: z.number().nullable(), page: z.number().nullable() }),
    )
    .default([]),
  holders: z
    .array(
      z.object({
        investor: z.string(),
        holder_key: z.string(),
        pct: z.number(),
        controller: z.boolean().nullable(),
        controller_affiliate: z.boolean().nullable(),
        page: z.number(),
      }),
    )
    .default([]),
});

const onePctHolderSchema = z.object({
  investor: z.string(),
  holder_key: z.string(),
  shares: z.number(),
  pct: z.number(),
  classification: z.string().nullable(),
  local_foreign: z.string().nullable(),
});

export const tickerSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  prices: z.array(
    z.object({
      date: z.string(),
      open: z
        .number()
        .nullable()
        .optional()
        .transform((value) => value ?? null),
      high: z
        .number()
        .nullable()
        .optional()
        .transform((value) => value ?? null),
      low: z
        .number()
        .nullable()
        .optional()
        .transform((value) => value ?? null),
      close: z.number(),
      volume: z.number(),
      value: z.number(),
      net_foreign: z.number(),
    }),
  ),
  holders: z.array(
    z.object({ investor: z.string(), holder_key: z.string(), shares: z.number(), pct: z.number() }),
  ),
  changes: z.array(ownershipChangeSchema.extend({ date: z.string(), holder_key: z.string() })),
  one_pct: z
    .object({
      date: z.string().nullable(),
      holders: z.array(onePctHolderSchema),
    })
    .default({ date: null, holders: [] }),
  one_pct_history: z
    .array(
      z.object({
        date: z.string(),
        holders: z.array(onePctHolderSchema),
      }),
    )
    .default([]),
  disclosures: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        published_at: z.string(),
        url: z.url(),
        kind: z.enum(['insider', 'registry', 'other']),
        attachments: z.array(
          z.object({ name: z.string(), url: z.url(), label: z.string().nullable().optional() }),
        ),
      }),
    )
    .default([]),
  insiders: z
    .array(
      z.object({
        date: z.string(),
        reporter: z.string().nullable(),
        holder_key: z.string().nullable(),
        shares_before: z.number().nullable(),
        shares_after: z.number().nullable(),
        net_shares: z.number().nullable(),
        url: z.url(),
      }),
    )
    .default([]),
  registry_history: z.array(registrySchema).default([]),
});

const newsSchema = z.array(
  z.object({
    title: z.string(),
    url: z.url(),
    published_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
    source: z.string(),
  }),
);

export async function loadNews(ticker: string, range?: { start: string; end: string }) {
  const params = new URLSearchParams({ ticker });
  if (range) {
    params.set('from', range.start);
    params.set('to', range.end);
  }
  const response = await fetch(`/api/news?${params}`);
  if (!response.ok) throw new Error('Could not load news');
  return newsSchema.parse(await response.json());
}

export type Health = z.infer<typeof healthSchema>;

// The daily batch publishes around 10:30 UTC every day, weekends included, and is
// checked at 12:00 UTC. A snapshot from before that day's run is stale.
export function staleSince(health: Health, now = Date.now()) {
  const check = new Date(now);
  check.setUTCHours(12, 0, 0, 0);
  if (check.getTime() > now) check.setUTCDate(check.getUTCDate() - 1);
  const published = Date.parse(`${health.run_at.slice(0, 19).replace(' ', 'T')}Z`);
  return published < check.getTime() - 2 * 3600e3 ? health.run_at.slice(0, 10) : null;
}

const sourceLabels = {
  prices: 'Prices',
  indices: 'Indices',
  five_pct: '5% ownership',
  one_pct: 'Registry',
  issuers: 'Issuers',
  disclosures: 'Disclosures',
  brokers: 'Broker flow',
  corporate_actions: 'Corporate actions',
  risk: 'Risk flags',
} as const satisfies Partial<Record<keyof Health, string>>;
const isSource = (source: string): source is keyof typeof sourceLabels =>
  Object.hasOwn(sourceLabels, source);

// A missed run makes the whole page stale; otherwise each source the last run failed is behind.
export function staleSources(health: Health, now = Date.now()) {
  const since = staleSince(health, now);
  if (since) return [{ label: null, since }];
  return health.failed
    .filter(isSource)
    .map((source) => ({ label: sourceLabels[source], since: health[source] }));
}
export type Market = z.infer<typeof marketSchema>;
export type Feed = z.infer<typeof feedSchema>;
export type Stock = z.infer<typeof stocksSchema>[number];
export type Ticker = z.infer<typeof tickerSchema>;

type TickerPath = `ticker/${string}.json`;
export function load(path: 'health.json'): Promise<Health>;
export function load(path: 'market-summary.json'): Promise<MarketSummary>;
export function load(path: 'market.json'): Promise<Market>;
export function load(path: 'feed.json'): Promise<Feed>;
export function load(path: 'tickers.json'): Promise<Stock[]>;
export function load(path: TickerPath): Promise<Ticker | null>;
export async function load(
  path:
    | 'market-summary.json'
    | 'health.json'
    | 'market.json'
    | 'feed.json'
    | 'tickers.json'
    | TickerPath,
) {
  const response = await fetch(`/data/${path}`);
  if (response.status === 404 && path.startsWith('ticker/')) return null;
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  const json: unknown = await response.json();
  switch (path) {
    case 'health.json':
      return healthSchema.parse(json);
    case 'market-summary.json':
      return marketSummarySchema.parse(json);
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

export const corporateActionSchema = z.object({
  ticker: z.string(),
  kind: z.enum(['DIV', 'RIGHTS', 'BONUS', 'SPLIT', 'RUPS', 'IPO', 'DELIST']),
  label: z.string(),
  amount: z
    .object({ value: z.number().positive(), currency: z.string().regex(/^[A-Z]{3}$/) })
    .nullable()
    .default(null),
  steps: z.array(
    z.object({
      step: z.enum([
        'cum',
        'ex',
        'record',
        'pay',
        'distribution',
        'listing',
        'trade_start',
        'trade_end',
        'meeting',
        'delisting',
      ]),
      date: z.string(),
    }),
  ),
});
export const riskSchema = z.object({
  notes: z.array(z.object({ code: z.string(), text: z.string() })),
  susp: z.object({ since: z.string(), reason: z.string().nullable(), url: z.url() }).nullable(),
  uma: z.object({ date: z.string(), url: z.url() }).nullable(),
});

export const corporateActionsSchema = z.array(corporateActionSchema);
export const risksSchema = z.record(z.string(), riskSchema);
