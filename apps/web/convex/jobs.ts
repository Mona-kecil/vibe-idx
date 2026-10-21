import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { payload, source } from './schema';

async function enqueueJob(
  ctx: MutationCtx,
  job: Pick<Doc<'ingestJobs'>, 'key' | 'source' | 'payload'>,
) {
  const existing = await ctx.db
    .query('ingestJobs')
    .withIndex('by_key', (q) => q.eq('key', job.key))
    .unique();
  if (existing) return;
  await ctx.db.insert('ingestJobs', {
    ...job,
    status: 'pending',
    attempts: 0,
    nextRunAt: Date.now(),
    updatedAt: Date.now(),
  });
}
export const enqueue = internalMutation({
  args: { key: v.string(), source, payload },
  handler: enqueueJob,
});
export const enqueueDates = internalMutation({
  args: { dates: v.array(v.string()), refresh: v.boolean(), issuers: v.boolean() },
  handler: async (ctx, args) => {
    for (const date of args.dates) {
      const sources = args.issuers
        ? (['issuers'] satisfies Doc<'ingestJobs'>['source'][])
        : (['prices', 'indices'] satisfies Doc<'ingestJobs'>['source'][]);
      for (const source of sources) {
        const key = `${source}:${date}`;
        const url =
          source === 'issuers'
            ? 'https://www.idx.id/primary/ListedCompany/GetCompanyProfiles?emitenType=s&start=0&length=9999'
            : `https://www.idx.id/primary/TradingSummary/${source === 'prices' ? 'GetStockSummary' : 'GetIndexSummary'}?date=${date.replaceAll('-', '')}&start=0&length=${source === 'prices' ? 9999 : 50}`;
        await enqueueJob(ctx, { key, source, payload: { date, url } });
        if (args.refresh) {
          const job = await ctx.db
            .query('ingestJobs')
            .withIndex('by_key', (q) => q.eq('key', key))
            .unique();
          if (job?.status === 'done')
            await ctx.db.patch(job._id, {
              status: 'pending',
              attempts: 0,
              nextRunAt: Date.now(),
              updatedAt: Date.now(),
            });
        }
      }
    }
  },
});
function failedPatch(job: Doc<'ingestJobs'>, error: string): Partial<Doc<'ingestJobs'>> {
  const attempts = job.attempts + 1;
  return {
    status: 'failed',
    attempts,
    lastError: error,
    nextRunAt: attempts < 5 ? Date.now() + 60000 * 2 ** (attempts - 1) : undefined,
    updatedAt: Date.now(),
  };
}
export const claim = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const running = await ctx.db
      .query('ingestJobs')
      .withIndex('by_status_nextRunAt', (q) => q.eq('status', 'running'))
      .first();
    if (running) {
      if ((running.nextRunAt ?? Infinity) > now) return null;
      await ctx.db.patch(running._id, failedPatch(running, 'Worker lease expired'));
    }
    const pending = await ctx.db
      .query('ingestJobs')
      .withIndex('by_status_nextRunAt', (q) => q.eq('status', 'pending'))
      .collect();
    const failed = await ctx.db
      .query('ingestJobs')
      .withIndex('by_status_nextRunAt', (q) => q.eq('status', 'failed'))
      .collect();
    const candidates = [...pending, ...failed.filter((j) => j.attempts < 5)].sort(
      (a, b) => a.payload.date.localeCompare(b.payload.date) || a.key.localeCompare(b.key),
    );
    const firstFive = candidates.find((j) => j.source === 'fivePct');
    const job = candidates.find(
      (j) => (j.nextRunAt ?? 0) <= now && (j.source !== 'fivePct' || j._id === firstFive?._id),
    );
    if (!job) return null;
    const patch = {
      status: 'running',
      nextRunAt: now + 11 * 60000,
      updatedAt: now,
    } satisfies Partial<Doc<'ingestJobs'>>;
    await ctx.db.patch(job._id, patch);
    return { ...job, ...patch };
  },
});
export const finish = internalMutation({
  args: {
    id: v.id('ingestJobs'),
    lease: v.number(),
    hash: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job || job.status !== 'running' || job.updatedAt !== args.lease)
      throw new Error('Lost job lease');
    await ctx.db.patch(
      job._id,
      args.error === undefined
        ? {
            status: 'done',
            contentHash: args.hash,
            nextRunAt: undefined,
            lastError: undefined,
            updatedAt: Date.now(),
          }
        : failedPatch(job, args.error),
    );
  },
});
