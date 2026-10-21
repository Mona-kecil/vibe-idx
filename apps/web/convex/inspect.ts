import { v } from 'convex/values';
import { internalAction, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { PaginationResult } from 'convex/server';
import type { Doc, TableNames } from './_generated/dataModel';
const table = v.union(
  v.literal('issuers'),
  v.literal('dailyPrices'),
  v.literal('indexDaily'),
  v.literal('fivePctHoldings'),
  v.literal('fivePctChanges'),
  v.literal('onePctHoldings'),
  v.literal('ingestJobs'),
);
export const countPage = internalQuery({
  args: { table, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const result = await ctx.db.query(args.table).paginate({ cursor: args.cursor, numItems: 500 });
    return {
      count: result.page.length,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
export const ledger = internalQuery({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db.query('ingestJobs').collect();
    return {
      pending: jobs.filter((j) => j.status === 'pending').length,
      running: jobs.filter((j) => j.status === 'running').length,
      done: jobs.filter((j) => j.status === 'done').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      errors: jobs
        .filter((j) => j.status === 'failed')
        .map((j) => ({
          key: j.key,
          attempts: j.attempts,
          lastError: j.lastError,
          nextRunAt: j.nextRunAt,
        })),
    };
  },
});
export const counts = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    tables: Partial<Record<TableNames, number>>;
    ledger: {
      pending: number;
      running: number;
      done: number;
      failed: number;
      errors: { key: string; attempts: number; lastError?: string; nextRunAt?: number }[];
    };
  }> => {
    const tables: Partial<Record<TableNames, number>> = {};
    for (const name of [
      'issuers',
      'dailyPrices',
      'indexDaily',
      'fivePctHoldings',
      'fivePctChanges',
      'onePctHoldings',
      'ingestJobs',
    ] satisfies TableNames[]) {
      let cursor: string | null = null;
      let count = 0;
      for (;;) {
        const page: Pick<PaginationResult<Doc<TableNames>>, 'isDone' | 'continueCursor'> & {
          count: number;
        } = await ctx.runQuery(internal.inspect.countPage, { table: name, cursor });
        count += page.count;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      tables[name] = count;
    }
    return { tables, ledger: await ctx.runQuery(internal.inspect.ledger, {}) };
  },
});
export const marketRows = internalQuery({
  args: { date: v.string() },
  handler: async (ctx, { date }) => ({
    BBCA: await ctx.db
      .query('dailyPrices')
      .withIndex('by_date_ticker', (q) => q.eq('date', date).eq('ticker', 'BBCA'))
      .unique(),
    IHSG: await ctx.db
      .query('indexDaily')
      .withIndex('by_code_date', (q) => q.eq('code', 'COMPOSITE').eq('date', date))
      .unique(),
  }),
});
