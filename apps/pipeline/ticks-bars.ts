import { gunzipSync, gzipSync } from 'node:zlib';
import { z } from 'zod';
import {
  barFileSchema,
  packBars,
  sessionBars,
  sessionStart,
  unpackBars,
  type TickTrades,
} from '../web/src/ticks';
import type { R2 } from './brokers';
import { sessionDate } from './ticks-data';

const barsKey = (ticker: string) => `site/bars/${ticker}.json.gz`;
/** The sessions whose bars are published for every ticker, so a session published before bars existed is found. */
const sessionsKey = 'site/bars/sessions.json';
const sessionsSchema = z.object({ sessions: z.array(sessionDate) });

/**
 * Puts one session's bars into a ticker's bar file, replacing whatever the file held for that session. Rerunning it
 * for a republished session gives the same file as running it once.
 */
export async function publishTickerBars(r2: R2, date: string, json: string) {
  // The trade file's own JSON, written by the SQL that publishes it, so it needs no second check.
  const trades = JSON.parse(json) as TickTrades;
  const stored = await r2.get(barsKey(trades.ticker));
  const kept = stored
    ? unpackBars(barFileSchema.parse(JSON.parse(gunzipSync(stored.bytes).toString())))
    : [];
  const start = sessionStart(date);
  const others = kept.filter((bar) => bar.time < start || bar.time >= start + 86400);
  const rows = sessionBars(trades);
  if (!stored && !rows.length) return;
  await r2.put(
    barsKey(trades.ticker),
    gzipSync(JSON.stringify(packBars(trades.ticker, [...others, ...rows]))),
  );
}

export async function publishedBarSessions(r2: R2) {
  const stored = await r2.get(sessionsKey);
  return new Set(
    stored ? sessionsSchema.parse(JSON.parse(stored.bytes.toString('utf8'))).sessions : [],
  );
}

export async function markBarSession(r2: R2, date: string) {
  const sessions = await publishedBarSessions(r2);
  sessions.add(date);
  await r2.put(sessionsKey, Buffer.from(JSON.stringify({ sessions: [...sessions].sort() })));
}
