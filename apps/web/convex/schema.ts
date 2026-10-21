import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const source = v.union(
  v.literal('issuers'),
  v.literal('prices'),
  v.literal('indices'),
  v.literal('fivePct'),
  v.literal('onePct'),
);
export const payload = v.object({ date: v.string(), url: v.string() });
export const issuer = v.object({
  ticker: v.string(),
  name: v.string(),
  board: v.string(),
  sector: v.optional(v.string()),
  subSector: v.optional(v.string()),
  industry: v.optional(v.string()),
  subIndustry: v.optional(v.string()),
  updatedAt: v.number(),
});
export const price = v.object({
  date: v.string(),
  ticker: v.string(),
  previous: v.number(),
  open: v.number(),
  high: v.number(),
  low: v.number(),
  close: v.number(),
  change: v.number(),
  volume: v.number(),
  value: v.number(),
  frequency: v.number(),
  foreignBuy: v.number(),
  foreignSell: v.number(),
  listedShares: v.number(),
  tradableShares: v.number(),
  remarks: v.string(),
});
export const indexRow = v.object({
  date: v.string(),
  code: v.string(),
  previous: v.optional(v.number()),
  open: v.optional(v.number()),
  high: v.optional(v.number()),
  low: v.optional(v.number()),
  close: v.number(),
  change: v.optional(v.number()),
  volume: v.optional(v.number()),
  value: v.optional(v.number()),
  frequency: v.optional(v.number()),
});
export const fiveHolding = v.object({
  ticker: v.string(),
  investorName: v.string(),
  issuerName: v.string(),
  asOf: v.string(),
  combinedShares: v.number(),
  percent: v.number(),
  localForeign: v.string(),
  nationality: v.optional(v.string()),
  domicile: v.optional(v.string()),
  accounts: v.array(
    v.object({ holderName: v.string(), accountName: v.string(), shares: v.number() }),
  ),
});
export const fiveChange = v.object({
  date: v.string(),
  previousDate: v.string(),
  ticker: v.string(),
  investorName: v.string(),
  previousCombined: v.number(),
  currentCombined: v.number(),
  previousPercent: v.number(),
  currentPercent: v.number(),
  accounts: v.array(
    v.object({
      holderName: v.string(),
      accountName: v.string(),
      previousShares: v.number(),
      currentShares: v.number(),
      change: v.number(),
    }),
  ),
  localForeign: v.string(),
});
export const oneHolding = v.object({
  asOf: v.string(),
  ticker: v.string(),
  issuerName: v.string(),
  investorName: v.string(),
  classification: v.optional(v.string()),
  localForeign: v.optional(v.string()),
  nationality: v.optional(v.string()),
  domicile: v.optional(v.string()),
  scripless: v.optional(v.number()),
  scrip: v.optional(v.number()),
  total: v.number(),
  percent: v.number(),
});

export default defineSchema({
  issuers: defineTable(issuer).index('by_ticker', ['ticker']),
  dailyPrices: defineTable(price)
    .index('by_date_ticker', ['date', 'ticker'])
    .index('by_ticker_date', ['ticker', 'date']),
  indexDaily: defineTable(indexRow)
    .index('by_code_date', ['code', 'date'])
    .index('by_date', ['date']),
  fivePctHoldings: defineTable(fiveHolding).index('by_ticker_investor', ['ticker', 'investorName']),
  fivePctChanges: defineTable(fiveChange)
    .index('by_date', ['date'])
    .index('by_ticker_date', ['ticker', 'date']),
  onePctHoldings: defineTable(oneHolding)
    .index('by_asOf_ticker', ['asOf', 'ticker'])
    .index('by_ticker_asOf', ['ticker', 'asOf']),
  // Disclosure jobs and their source literals arrive with the disclosure slice.
  ingestJobs: defineTable({
    key: v.string(),
    source,
    payload,
    status: v.union(
      v.literal('pending'),
      v.literal('running'),
      v.literal('done'),
      v.literal('failed'),
    ),
    attempts: v.number(),
    nextRunAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_status_nextRunAt', ['status', 'nextRunAt']),
});
