import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { fiveChange, fiveHolding, indexRow, issuer, oneHolding, price } from './schema';

export const issuers = internalMutation({
  args: { rows: v.array(issuer) },
  handler: async (ctx, { rows }) => {
    if (rows.length > 500) throw new Error('Batch exceeds 500 rows');
    for (const row of rows) {
      const old = await ctx.db
        .query('issuers')
        .withIndex('by_ticker', (q) => q.eq('ticker', row.ticker))
        .unique();
      if (old) await ctx.db.replace(old._id, row);
      else await ctx.db.insert('issuers', row);
    }
  },
});
export const prices = internalMutation({
  args: { rows: v.array(price) },
  handler: async (ctx, { rows }) => {
    if (rows.length > 500) throw new Error('Batch exceeds 500 rows');
    for (const row of rows) {
      const old = await ctx.db
        .query('dailyPrices')
        .withIndex('by_date_ticker', (q) => q.eq('date', row.date).eq('ticker', row.ticker))
        .unique();
      if (old) await ctx.db.replace(old._id, row);
      else await ctx.db.insert('dailyPrices', row);
    }
  },
});
export const indices = internalMutation({
  args: { rows: v.array(indexRow) },
  handler: async (ctx, { rows }) => {
    if (rows.length > 500) throw new Error('Batch exceeds 500 rows');
    for (const row of rows) {
      const old = await ctx.db
        .query('indexDaily')
        .withIndex('by_code_date', (q) => q.eq('code', row.code).eq('date', row.date))
        .unique();
      if (old) await ctx.db.replace(old._id, row);
      else await ctx.db.insert('indexDaily', row);
    }
  },
});
export const onePct = internalMutation({
  args: { rows: v.array(oneHolding) },
  handler: async (ctx, { rows }) => {
    if (rows.length > 500) throw new Error('Batch exceeds 500 rows');
    for (const row of rows) {
      const old = await ctx.db
        .query('onePctHoldings')
        .withIndex('by_asOf_ticker', (q) => q.eq('asOf', row.asOf).eq('ticker', row.ticker))
        .filter((q) =>
          q.and(q.eq(q.field('investorName'), row.investorName), q.eq(q.field('seq'), row.seq)),
        )
        .unique();
      if (old) await ctx.db.replace(old._id, row);
      else await ctx.db.insert('onePctHoldings', row);
    }
  },
});
export const holdingsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db.query('fivePctHoldings').paginate({ cursor, numItems: 200 });
    return { ...result, page: result.page.map(({ _id, _creationTime, ...holding }) => holding) };
  },
});
export const fivePct = internalMutation({
  args: {
    rows: v.array(
      v.object({
        holding: v.optional(fiveHolding),
        change: v.optional(fiveChange),
        exit: v.optional(fiveHolding),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    if (rows.length > 250) throw new Error('Batch exceeds 500 writes');
    for (const row of rows) {
      if (row.change) {
        const change = row.change;
        const old = await ctx.db
          .query('fivePctChanges')
          .withIndex('by_ticker_date', (q) => q.eq('ticker', change.ticker).eq('date', change.date))
          .filter((q) => q.eq(q.field('investorName'), change.investorName))
          .unique();
        if (old) await ctx.db.replace(old._id, change);
        else await ctx.db.insert('fivePctChanges', change);
      }
      const h = row.holding ?? row.exit;
      if (!h) continue;
      const old = await ctx.db
        .query('fivePctHoldings')
        .withIndex('by_ticker_investor', (q) =>
          q.eq('ticker', h.ticker).eq('investorName', h.investorName),
        )
        .unique();
      if (row.holding && (!old || old.asOf < h.asOf)) {
        if (old) await ctx.db.replace(old._id, row.holding);
        else await ctx.db.insert('fivePctHoldings', row.holding);
      } else if (row.exit && old && old.asOf < (row.change?.date ?? ''))
        await ctx.db.delete(old._id);
    }
  },
});
