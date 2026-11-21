import { load } from '../data.js';

async function fetchTerminalData() {
  const [stocks, market, health, feed, summary] = await Promise.all([
    load('tickers.json'),
    load('market.json'),
    load('health.json'),
    load('feed.json'),
    load('market-summary.json'),
  ]);
  return { stocks, market, health, feed, summary };
}
export type TerminalData = Awaited<ReturnType<typeof fetchTerminalData>>;

let early: Promise<TerminalData> | null = null;
/** Starts the Terminal's data while its code downloads, instead of after. */
export function prefetchTerminalData() {
  if (early) return;
  early = fetchTerminalData();
  // The Terminal handles a failure when it takes the promise; this only keeps an early one from being reported.
  early.catch(() => {});
}
/** The prefetched data the first time, a fresh request after that, so Retry asks again. */
export function terminalData() {
  const data = early ?? fetchTerminalData();
  early = null;
  return data;
}
