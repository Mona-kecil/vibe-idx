import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import type { R2 } from './brokers';
import { nextPreOpen, tradingSessions } from './lib/idx-calendar';
import { reportError } from './lib/sentry';
import {
  parseBook,
  parseTradePage,
  sessionDate,
  sqlLiteral as lit,
  tickerCode,
} from './ticks-data';
import type { BookRow, Trade } from './ticks-data';
import { TickStore } from './ticks-store';
import type { Dataset } from './ticks-store';

export type TickSummary = { published: string[]; pending: string[]; stopped?: string };
type Request = (url: string, deadline: number) => Promise<Response | undefined>;
class TickStop extends Error {}

export async function collectTicks({
  data,
  r2,
  request,
  deadline,
  minutes = Number(process.env.TICKS_BUDGET_MINUTES ?? 45),
  report = reportError,
}: {
  data: string;
  r2: R2;
  request: Request;
  deadline: number;
  minutes?: number;
  report?: typeof reportError;
}): Promise<TickSummary> {
  if (!Number.isFinite(minutes) || minutes <= 0)
    throw new Error('TICKS_BUDGET_MINUTES must be positive');
  const end = Math.min(deadline, Date.now() + minutes * 60000);
  const store = await TickStore.open(data, r2);
  const summary: TickSummary = { published: [], pending: [] };
  const next = { running_trade: 0, closing_book: 0 };
  const bounded = () => Date.now() >= end;
  async function paced(url: URL, dataset: Dataset): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      await setTimeout(Math.max(0, Math.min(next[dataset] - Date.now(), end - Date.now())));
      if (bounded()) return;
      next[dataset] = Date.now() + (dataset === 'running_trade' ? 250 : 200);
      let response: Response | undefined;
      try {
        response = await request(url.href, end);
      } catch (error) {
        if (bounded()) return;
        if (attempt >= 3) throw new TickStop('Tick request failed', { cause: error });
        await setTimeout(Math.min(1000, Math.max(0, end - Date.now())));
        continue;
      }
      if (!response) return;
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        next[dataset] = Date.now() + 1000;
        continue;
      }
      if (!response.ok) throw new TickStop(`Stockbit ${dataset} HTTP ${response.status}`);
      return response.json();
    }
  }
  async function tradePage(date: string, sort: 'ASC' | 'DESC', cursor = 0) {
    const url = new URL('https://exodus.stockbit.com/order-trade/running-trade');
    url.search = new URLSearchParams({
      date,
      sort,
      order_by: 'RUNNING_TRADE_ORDER_BY_TIME',
      limit: '100',
      ...(cursor ? { trade_number: String(cursor) } : {}),
    }).toString();
    const raw = await paced(url, 'running_trade');
    if (raw === undefined) return;
    return parseTradePage(raw, date);
  }
  async function closingSequence(date: string) {
    const last = await tradePage(date, 'DESC');
    // Trades sharing the final second come back in any order, so the first row is not always the highest number.
    return last && Math.max(0, ...last.map((r) => r.trade_number));
  }
  async function alreadyPublished(date: string, dataset: Dataset) {
    if (await store.complete(date, dataset)) {
      const p = await store.progress(date, dataset);
      if (p) await store.cleanup(p);
      return true;
    }
    return store.recoverPublished(date, dataset);
  }
  async function closingBook(date: string, tickers: string[], sessions: string[]) {
    if (await alreadyPublished(date, 'closing_book')) return;
    let p = await store.progress(date, 'closing_book');
    if (p && p.dataset !== 'closing_book') throw new Error('Invalid book progress');
    p ??= { dataset: 'closing_book', date, tickers, chunks: [], nextTicker: 0 };
    await store.targets(date, p.dataset, p.tickers);
    await store.restore(p);
    let rows: BookRow[] = [];
    let start = p.nextTicker;
    try {
      while (
        p.nextTicker < p.tickers.length &&
        !bounded() &&
        Date.now() < nextPreOpen(date, sessions)
      ) {
        const ticker = p.tickers[p.nextTicker];
        const url = new URL(
          `https://exodus.stockbit.com/company-price-feed/v2/orderbook/companies/${ticker}`,
        );
        const raw = await paced(url, 'closing_book');
        if (raw === undefined) break;
        // Recheck after network latency: a new session's book must never be attributed to yesterday.
        if (Date.now() >= nextPreOpen(date, sessions)) break;
        rows.push(...parseBook(raw, ticker, date, new Date().toISOString()));
        p.nextTicker++;
        if (p.nextTicker - start >= 25) {
          await store.checkpoint(p, rows, start, p.nextTicker);
          rows = [];
          start = p.nextTicker;
        }
      }
    } finally {
      await store.checkpoint(p, rows, start, p.nextTicker);
    }
    if (p.nextTicker === p.tickers.length && p.tickers.length) {
      await store.publish(p);
      summary.published.push(`closing_book/${date}`);
    } else summary.pending.push(`closing_book/${date}`);
  }
  async function runningTrade(date: string, tickers: string[]) {
    if (await alreadyPublished(date, 'running_trade')) return;
    let p = await store.progress(date, 'running_trade');
    if (p && p.dataset !== 'running_trade') throw new Error('Invalid trade progress');
    if (!p) {
      const expected = await closingSequence(date);
      if (expected === undefined) return;
      if (!expected) {
        // An observed trading session cannot be certified empty from an expired/empty API response.
        await store.targets(date, 'running_trade', tickers);
        await store.db.run(
          `UPDATE ledger SET status='unavailable' WHERE date=${lit(date)} AND dataset='running_trade'`,
        );
        summary.pending.push(`running_trade/${date}`);
        return;
      }
      p = {
        dataset: 'running_trade',
        date,
        tickers,
        chunks: [],
        expected,
        phase: 'bulk',
        cursor: 0,
        seen: [],
        repairs: 0,
      };
    }
    const progress = p;
    await store.targets(date, progress.dataset, progress.tickers);
    await store.restore(progress);
    let rows: Trade[] = [];
    let pages = 0;
    let start = progress.cursor;
    async function flush() {
      await store.checkpoint(progress, rows, start, progress.cursor);
      rows = [];
      pages = 0;
      start = progress.cursor;
    }
    async function take(page: Trade[]) {
      const top = Math.max(0, ...page.map((r) => r.trade_number));
      // Progress saved before closingSequence took the maximum can hold a count that is too low.
      if (top > progress.expected)
        progress.expected = Math.max(progress.expected, (await closingSequence(date)) ?? 0);
      if (top > progress.expected) throw new Error('Running trade exceeds closing sequence');
      rows.push(...page);
      pages++;
      if (pages >= 100) await flush();
    }
    try {
      while (progress.phase === 'bulk' && !bounded()) {
        const page = await tradePage(date, 'ASC', progress.cursor);
        if (!page) break;
        await take(page);
        const tail = page.at(-1)?.trade_number ?? progress.cursor;
        const exhausted = page.length < 100 || progress.seen.includes(tail);
        progress.seen.push(progress.cursor);
        progress.cursor = tail;
        if (exhausted) {
          progress.phase = 'repair';
          progress.cursor = 0;
          progress.seen = [];
          await flush();
        }
      }
      // Trades sharing a second come back in a different order on each request, so the cursor can skip one.
      // Re-read only the seconds around each gap; numbers still absent after that are not in Stockbit's feed.
      while (progress.phase === 'repair' && progress.repairs < 2 && !bounded()) {
        const { seconds } = await store.gaps(progress.expected);
        if (!seconds.length) break;
        for (const second of seconds) {
          let cursor = second.anchor;
          for (let read = 0; read < 20 && !bounded(); read++) {
            const page = await tradePage(date, 'ASC', cursor);
            if (!page?.length) break;
            await take(page);
            cursor = page.at(-1)!.trade_number;
            if (page.at(-1)!.time > second.time) break;
          }
        }
        if (bounded()) break;
        progress.repairs++;
        await flush();
      }
    } finally {
      await flush();
    }
    if (progress.phase !== 'repair' || (progress.repairs < 2 && bounded())) {
      summary.pending.push(`running_trade/${date}`);
      return;
    }
    const { missing } = await store.gaps(progress.expected);
    if (missing.length <= Math.max(20, progress.expected * 1e-5)) {
      await store.publish(progress, missing);
      summary.published.push(`running_trade/${date}`);
      return;
    }
    summary.pending.push(`running_trade/${date}`);
    // Far more gaps than cancelled trades explain means the crawl itself failed. Crawl the day again next run.
    Object.assign(progress, { phase: 'bulk', cursor: 0, seen: [], repairs: 0 });
    await flush();
    await report(new Error(`${missing.length} running trades missing for ${date}`), {
      source: 'ticks',
      dataset: progress.dataset,
      date,
    });
  }
  try {
    await store.db.run(
      `CREATE TEMP VIEW prices AS SELECT * FROM read_parquet(${lit(join(data, 'parquet', 'prices', '*.parquet'))})`,
    );
    const dates = tradingSessions(
      (await store.query('SELECT DISTINCT date::VARCHAR date FROM prices')).map((r) =>
        sessionDate.parse(r.date),
      ),
    );
    const now = Date.now();
    const latest = dates.filter((day) => Date.parse(`${day}T09:15:00Z`) <= now).at(-1);
    if (!latest) return summary;
    const tickers = (
      await store.query(
        `SELECT DISTINCT ticker FROM prices WHERE date=${lit(latest)} ORDER BY ticker`,
      )
    ).map((r) => tickerCode.parse(r.ticker));
    const started = await r2.get('ticks/collection.json');
    const first = started
      ? z.object({ first_session: sessionDate }).parse(JSON.parse(started.bytes.toString('utf8')))
          .first_session
      : latest;
    if (!started)
      await r2.put('ticks/collection.json', Buffer.from(JSON.stringify({ first_session: first })), {
        ifNoneMatch: '*',
      });
    async function alerts() {
      for (const date of dates.filter((d) => d >= first && nextPreOpen(d, dates) <= Date.now())) {
        for (const dataset of ['closing_book', 'running_trade'] satisfies Dataset[]) {
          await store.targets(date, dataset, tickers);
          // Reconcile an upload that survived a process death before its ledger checkpoint.
          if (await alreadyPublished(date, dataset)) continue;
          if (dataset === 'closing_book')
            await store.db.run(`UPDATE ledger SET status='missed'
            WHERE date=${lit(date)} AND dataset='closing_book'`);
          const [state] = await store.query(`SELECT bool_and(alerted) alerted FROM ledger
            WHERE date=${lit(date)} AND dataset=${lit(dataset)}`);
          if (state.alerted !== true) {
            await report(
              new Error(
                `${dataset === 'closing_book' ? 'Missed closing book' : 'Unpublished running trade at next pre-open'}: ${date}`,
              ),
              { source: 'ticks', dataset, date },
            );
            await store.db.run(
              `UPDATE ledger SET alerted=true WHERE date=${lit(date)} AND dataset=${lit(dataset)}`,
            );
          }
        }
      }
      await store.saveLedger();
    }
    await alerts();
    if (!bounded() && now < nextPreOpen(latest, dates)) await closingBook(latest, tickers, dates);
    // Negotiated trades print until about 16:30 Jakarta, after which the day's trade count is final.
    const completed = dates.filter((day) => Date.parse(`${day}T10:00:00Z`) <= Date.now());
    // Newest first, so collected history always extends back from today without gaps.
    for (const date of [...completed].reverse()) {
      if (bounded()) break;
      const symbols = (
        await store.query(
          `SELECT DISTINCT ticker FROM prices WHERE date=${lit(date)} ORDER BY ticker`,
        )
      ).map((r) => tickerCode.parse(r.ticker));
      await runningTrade(date, symbols);
      // Do not spend the whole run retrying a day with an expired API response or unresolved gaps.
    }
    await alerts();
    if (bounded()) summary.stopped = 'Tick time budget reached';
    return summary;
  } catch (error) {
    if (!(error instanceof TickStop)) throw error;
    summary.stopped = error.message;
    await report(error, { source: 'ticks' });
    return summary;
  } finally {
    await store.saveLedger();
    store.close();
  }
}
