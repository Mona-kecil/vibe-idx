import { v } from 'convex/values';
import { query } from './_generated/server';
import type { QueryCtx } from './_generated/server';

const surface = v.union(v.literal('prices'), v.literal('fivePct'), v.literal('onePct'));

// Seek past each date's index range instead of scanning its rows. At most 300 reads.
async function snapshotDates(ctx: QueryCtx, kind: 'prices' | 'fivePct' | 'onePct') {
  const dates: string[] = [];
  let before: string | undefined;
  for (let i = 0; i < 300; i++) {
    const row =
      kind === 'prices'
        ? await ctx.db
            .query('dailyPrices')
            .withIndex('by_date_ticker', (q) => (before ? q.lt('date', before) : q))
            .order('desc')
            .first()
        : kind === 'fivePct'
          ? await ctx.db
              .query('fivePctChanges')
              .withIndex('by_date', (q) => (before ? q.lt('date', before) : q))
              .order('desc')
              .first()
          : await ctx.db
              .query('onePctHoldings')
              .withIndex('by_asOf_ticker', (q) => (before ? q.lt('asOf', before) : q))
              .order('desc')
              .first();
    if (!row) break;
    before = 'date' in row ? row.date : row.asOf;
    dates.push(before);
  }
  return dates;
}

export const latestDates = query({
  args: {},
  handler: async (ctx) => {
    const [prices, fivePct, onePct] = await Promise.all([
      ctx.db.query('dailyPrices').withIndex('by_date_ticker').order('desc').first(),
      ctx.db.query('fivePctChanges').withIndex('by_date').order('desc').first(),
      ctx.db.query('onePctHoldings').withIndex('by_asOf_ticker').order('desc').first(),
    ]);
    return {
      prices: prices?.date ?? null,
      fivePctOwnership: fivePct?.date ?? null,
      onePctOwnership: onePct?.asOf ?? null,
    };
  },
});

export const dates = query({
  args: { kind: surface },
  handler: (ctx, { kind }) => snapshotDates(ctx, kind),
});

export const list = query({
  args: {
    kind: surface,
    date: v.string(),
    ticker: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const ticker = args.ticker.trim().toUpperCase();
    const options = {
      cursor: args.cursor,
      numItems: 50,
      maximumRowsRead: 50,
      maximumBytesRead: 1_000_000,
    };
    switch (args.kind) {
      case 'prices': {
        const result = await ctx.db
          .query('dailyPrices')
          .withIndex('by_date_ticker', (q) => {
            const range = q.eq('date', args.date);
            return ticker ? range.eq('ticker', ticker) : range;
          })
          .paginate(options);
        return { ...result, kind: 'prices' as const };
      }
      case 'fivePct': {
        const rows = ticker
          ? ctx.db
              .query('fivePctChanges')
              .withIndex('by_ticker_date', (q) => q.eq('ticker', ticker).eq('date', args.date))
          : ctx.db.query('fivePctChanges').withIndex('by_date', (q) => q.eq('date', args.date));
        return { ...(await rows.paginate(options)), kind: 'fivePct' as const };
      }
      case 'onePct': {
        const result = await ctx.db
          .query('onePctHoldings')
          .withIndex('by_asOf_ticker', (q) => {
            const range = q.eq('asOf', args.date);
            return ticker ? range.eq('ticker', ticker) : range;
          })
          .paginate(options);
        return { ...result, kind: 'onePct' as const };
      }
    }
  },
});
