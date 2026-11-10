import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import { corporateActionsSchema } from '../web/src/data';
import type { R2 } from './brokers';
import { completeActivityBoards } from './sql';

const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const day = z.iso.date();
const amount = z.coerce.number().finite().nonnegative();
const responseSchema = z.object({
  data: z.object({
    from: day,
    to: day,
    bandar_detector: z.object({ total_buyer: z.int(), total_seller: z.int() }),
    broker_summary: z.object({
      symbol: z.string(),
      brokers_buy: z.array(
        z.object({ netbs_broker_code: z.string(), blotv: amount, bval: amount }),
      ),
      brokers_sell: z.array(
        z.object({ netbs_broker_code: z.string(), slotv: amount, sval: amount }),
      ),
    }),
  }),
});
const storedSchema = z.array(
  z.object({ side: z.enum(['buy', 'sell']), broker: z.string(), shares: amount, value: amount }),
);
// Event key ("TICKER:ex") to the Jakarta date it was last checked, or "alerted" once reported.
const stateSchema = z.record(z.string(), z.union([day, z.literal('alerted')]));
const stateKey = 'broker-rescale-checks.json';
const kinds = new Set(['SPLIT', 'RIGHTS', 'BONUS']);
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, a, b);

type Amounts = { shares: number; value: number };
export type RescaleReport = {
  ticker: string;
  kind: string;
  ex: string;
  probe: string;
  factor: number | null;
  mismatched: string[];
};

function current(raw: unknown, ticker: string, probe: string) {
  const { data } = responseSchema.parse(raw);
  const { brokers_buy: buy, brokers_sell: sell } = data.broker_summary;
  if (data.from !== probe || data.to !== probe || data.broker_summary.symbol !== ticker)
    throw new Error(`Rescale probe answered for another stock or day: ${ticker} ${probe}`);
  if (
    buy.length !== data.bandar_detector.total_buyer ||
    sell.length !== data.bandar_detector.total_seller
  )
    throw new Error(`Incomplete rescale probe: ${ticker} ${probe}`);
  const rows = new Map<string, Amounts>();
  for (const r of buy) rows.set(`buy:${r.netbs_broker_code}`, { shares: r.blotv, value: r.bval });
  for (const r of sell) rows.set(`sell:${r.netbs_broker_code}`, { shares: r.slotv, value: r.sval });
  return rows;
}

function compare(stored: Map<string, Amounts>, fresh: Map<string, Amounts>) {
  const mismatched: string[] = [];
  const ratios: number[] = [];
  for (const key of new Set([...stored.keys(), ...fresh.keys()])) {
    const [a, b] = [stored.get(key), fresh.get(key)];
    if (!a || !b || !close(a.value, b.value)) mismatched.push(key);
    else if (a.shares > 0 && !close(a.shares, b.shares)) ratios.push(b.shares / a.shares);
  }
  ratios.sort((x, y) => x - y);
  return { mismatched, factor: ratios.length ? ratios[ratios.length >> 1] : null };
}

/**
 * After a split, rights issue or bonus, Stockbit rescales past share counts, while our stored history keeps the scale it was fetched at.
 * For ten trading days after each ex date, compare the last complete session before it with Stockbit once a day, and report any difference.
 */
export async function checkRescales({
  data,
  r2,
  access,
  fetcher = fetch,
  now = new Date(),
  report = async (event: RescaleReport) => {
    Sentry.captureMessage(`Stockbit broker history differs for ${event.ticker}`, {
      level: 'error',
      fingerprint: ['broker-rescale', event.ticker, event.ex],
      extra: event,
    });
    return Sentry.flush(5000);
  },
}: {
  data: string;
  r2: R2;
  access: () => Promise<string | undefined>;
  fetcher?: typeof fetch;
  now?: Date;
  report?: (event: RescaleReport) => Promise<boolean>;
}) {
  const parquet = join(data, 'parquet');
  const files = {
    corporate_actions: join(parquet, 'corporate_actions', '*.parquet'),
    prices: join(parquet, 'prices', '*.parquet'),
    broker_activity: join(parquet, 'broker_activity', '*.parquet'),
    broker_activity_coverage: join(parquet, 'broker-activity-coverage.parquet'),
  };
  for (const dir of ['corporate_actions', 'prices', 'broker_activity'])
    if (!existsSync(join(parquet, dir))) return [];
  if (!existsSync(files.broker_activity_coverage)) return [];
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  const query = async (sql: string) => (await db.runAndReadAll(sql)).getRowObjectsJson();
  const reports: RescaleReport[] = [];
  try {
    for (const [view, file] of Object.entries(files))
      await db.run(`CREATE VIEW ${view} AS SELECT * FROM read_parquet(${literal(file)})`);
    const sessions = (
      await query(`SELECT DISTINCT date::VARCHAR date FROM prices
        WHERE volume > 0 AND date <= DATE ${literal(today)} ORDER BY date DESC LIMIT 11`)
    ).map((r) => day.parse(r.date));
    const oldest = sessions.at(-1);
    if (!oldest) return [];
    // Each snapshot only lists recent events, so read all of them to keep an event for its whole window.
    const events = new Map<string, { ticker: string; kind: string; ex: string }>();
    for (const row of await query('SELECT payload::VARCHAR payload FROM corporate_actions'))
      for (const action of corporateActionsSchema.parse(JSON.parse(z.string().parse(row.payload))))
        for (const step of action.steps)
          if (
            kinds.has(action.kind) &&
            step.step === 'ex' &&
            step.date > oldest &&
            step.date <= today
          )
            events.set(`${action.ticker}:${step.date}`, { ...action, ex: step.date });
    if (!events.size) return [];

    const saved = await r2.get(stateKey);
    const state = stateSchema.parse(saved ? JSON.parse(saved.bytes.toString('utf8')) : {});
    for (const key of Object.keys(state)) if (!events.has(key)) delete state[key];
    let etag = saved?.etag;
    const save = async () => {
      const bytes = Buffer.from(JSON.stringify(state));
      etag = await r2.put(stateKey, bytes, etag ? { ifMatch: etag } : { ifNoneMatch: '*' });
    };

    for (const [key, { ticker, kind, ex }] of events) {
      if (state[key] === today || state[key] === 'alerted') continue;
      const [probeRow] = await query(`SELECT max(a.date)::VARCHAR date FROM broker_activity a
        JOIN (${completeActivityBoards}) c USING (date, board)
        WHERE a.board = 'regular' AND a.ticker = ${literal(ticker)} AND a.date < DATE ${literal(ex)}`);
      if (typeof probeRow?.date !== 'string') continue;
      const probe = day.parse(probeRow.date);
      const stored = new Map(
        storedSchema
          .parse(
            await query(`SELECT side, broker, sum(shares) AS shares, sum(value) AS value FROM broker_activity
              WHERE board = 'regular' AND ticker = ${literal(ticker)} AND date = DATE ${literal(probe)}
              GROUP BY side, broker`),
          )
          .map(({ side, broker, ...amounts }) => [`${side}:${broker}`, amounts]),
      );
      // Saved before the request, so a failing probe waits for tomorrow instead of the next ten-minute run.
      state[key] = today;
      await save();
      try {
        const token = await access();
        if (!token) break;
        const url = new URL(
          `https://exodus.stockbit.com/marketdetectors/${encodeURIComponent(ticker)}`,
        );
        url.search = new URLSearchParams({
          from: probe,
          to: probe,
          transaction_type: 'TRANSACTION_TYPE_GROSS',
          market_board: 'MARKET_BOARD_REGULER',
          investor_type: 'INVESTOR_TYPE_ALL',
          limit: '200',
        }).toString();
        const response = await fetcher(url, {
          headers: {
            Accept: 'application/json',
            Origin: 'https://stockbit.com',
            Referer: 'https://stockbit.com/',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            Authorization: `Bearer ${token}`,
          },
          redirect: 'error',
          signal: AbortSignal.timeout(60000),
        });
        if (!response.ok) throw new Error(`Stockbit HTTP ${response.status}`);
        const { mismatched, factor } = compare(
          stored,
          current(await response.json(), ticker, probe),
        );
        if (!mismatched.length && factor === null) continue;
        const event = { ticker, kind, ex, probe, factor, mismatched };
        reports.push(event);
        if (await report(event)) {
          state[key] = 'alerted';
          await save();
        }
      } catch (error) {
        console.error(
          JSON.stringify({ check: 'broker-rescale', ticker, ex, error: String(error) }),
        );
      }
    }
    return reports;
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}
