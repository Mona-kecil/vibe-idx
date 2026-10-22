'use node';
import { createHash } from 'node:crypto';
import type { PaginationResult } from 'convex/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import type { ActionCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { date } from './lib/rows';
import type { FiveChange, FiveHolding } from './lib/rows';
import { parseIssuers } from './lib/issuers';
import { parsePrices } from './lib/prices';
import { parseIndices } from './lib/indices';
import { parseOwnershipList, idxUrl } from './lib/ownershipList';
import { deriveFivePct, parseFivePct } from './lib/fivePct';
import { parseOnePct } from './lib/onePct';

async function fetchBytes(url: string) {
  const response = await fetch(idxUrl(url), {
    signal: AbortSignal.timeout(60000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`IDX HTTP ${response.status}: ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}
function chunks<T>(rows: T[], size = 500): T[][] {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, i) =>
    rows.slice(i * size, (i + 1) * size),
  );
}
async function discover(ctx: ActionCtx, year: number) {
  const files = parseOwnershipList(
    JSON.parse(
      new TextDecoder().decode(
        await fetchBytes(
          `https://www.idx.id/primary/list/id/perusahaan-tercatat/data-kepemilikan-saham/?year=${year}&lang=id&start=0&length=9999`,
        ),
      ),
    ),
  );
  for (const file of files)
    await ctx.runMutation(internal.jobs.enqueue, {
      key: `${file.source}:${file.url}`,
      source: file.source,
      payload: { date: file.date, url: file.url },
    });
  return files.length;
}
export const discoverOwnership = internalAction({
  args: {},
  handler: (ctx) => discover(ctx, new Date().getUTCFullYear()),
});
export const dailyIssuers = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.jobs.enqueueDates, {
      dates: [new Date().toISOString().slice(0, 10)],
      refresh: true,
      issuers: true,
    });
  },
});
export const dailyMarket = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.jobs.enqueueDates, {
      dates: [new Date().toISOString().slice(0, 10)],
      refresh: true,
      issuers: false,
    });
  },
});
export const backfill = internalAction({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args): Promise<{ weekdays: number; ownershipFiles: number }> => {
    const from = date(args.from);
    const to = date(args.to);
    if (from > to) throw new Error('from must precede to');
    const dates: string[] = [];
    for (
      const d = new Date(from);
      d.toISOString().slice(0, 10) <= to;
      d.setUTCDate(d.getUTCDate() + 1)
    )
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(d.toISOString().slice(0, 10));
    for (const batch of chunks(dates, 100))
      await ctx.runMutation(internal.jobs.enqueueDates, {
        dates: batch,
        refresh: false,
        issuers: false,
      });
    await ctx.runMutation(internal.jobs.enqueueDates, {
      dates: [new Date().toISOString().slice(0, 10)],
      refresh: false,
      issuers: true,
    });
    return { weekdays: dates.length, ownershipFiles: await discover(ctx, 2026) };
  },
});
async function processJob(ctx: ActionCtx, job: Doc<'ingestJobs'>, bytes: Uint8Array) {
  switch (job.source) {
    case 'issuers':
      for (const rows of chunks(
        parseIssuers(JSON.parse(new TextDecoder().decode(bytes)), job.updatedAt),
      ))
        await ctx.runMutation(internal.writes.issuers, { rows });
      break;
    case 'prices':
      for (const rows of chunks(parsePrices(JSON.parse(new TextDecoder().decode(bytes)))))
        await ctx.runMutation(internal.writes.prices, { rows });
      break;
    case 'indices':
      for (const rows of chunks(parseIndices(JSON.parse(new TextDecoder().decode(bytes)))))
        await ctx.runMutation(internal.writes.indices, { rows });
      break;
    case 'onePct':
      for (const rows of chunks(parseOnePct(bytes)))
        await ctx.runMutation(internal.writes.onePct, { rows });
      break;
    case 'fivePct': {
      const previous: FiveHolding[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page: PaginationResult<FiveHolding> = await ctx.runQuery(
          internal.writes.holdingsPage,
          { cursor },
        );
        previous.push(...page.page);
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      const result = deriveFivePct(parseFivePct(bytes), previous);
      const key = (h: { ticker: string; investorName: string }) =>
        JSON.stringify([h.ticker, h.investorName]);
      const changes = new Map(result.changes.map((c) => [key(c), c]));
      const rows: { holding?: FiveHolding; change?: FiveChange; exit?: FiveHolding }[] = [
        ...result.holdings.map((holding) => ({ holding, change: changes.get(key(holding)) })),
        ...result.exits.map((exit) => ({ exit, change: changes.get(key(exit)) })),
      ];
      const included = new Set([...result.holdings, ...result.exits].map(key));
      for (const change of result.changes)
        if (!included.has(key(change))) rows.push({ change, holding: undefined });
      for (const batch of chunks(rows, 200))
        await ctx.runMutation(internal.writes.fivePct, { rows: batch });
      break;
    }
    default: {
      const exhaustive: never = job.source;
      throw new Error('Unknown source: ' + String(exhaustive));
    }
  }
}
export const worker = internalAction({
  args: {},
  handler: async (ctx): Promise<{ completed: number; failed: number }> => {
    const started = Date.now();
    let completed = 0;
    let failed = 0;
    while (Date.now() - started < 8 * 60000) {
      const job = await ctx.runMutation(internal.jobs.claim, {});
      if (!job) break;
      try {
        const bytes = await fetchBytes(job.payload.url);
        const hash = createHash('sha256').update(bytes).digest('hex');
        if (hash !== job.contentHash) await processJob(ctx, job, bytes);
        await ctx.runMutation(internal.jobs.finish, { id: job._id, lease: job.updatedAt, hash });
        completed++;
      } catch (error) {
        await ctx.runMutation(internal.jobs.finish, {
          id: job._id,
          lease: job.updatedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
      }
    }
    return { completed, failed };
  },
});
