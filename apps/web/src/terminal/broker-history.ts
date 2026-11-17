import type { BrokerDay } from '../brokers';
import { fetchBrokers } from './sources.js';

// A ticker's history is megabytes, so only the last few tickers stay. Broker data is published once an evening, and
// a terminal left open across it must not show the day before for long.
const kept = 3;
const lifetime = 10 * 60 * 1000;

const histories = new Map<string, { loadedAt: number; days: Promise<BrokerDay[]> }>();

/** A ticker's broker history. Returning to a ticker, or asking while it loads, shares one request. */
export function loadBrokerHistory(
  ticker: string,
  getToken: () => Promise<string | undefined>,
): Promise<BrokerDay[]> {
  const found = histories.get(ticker);
  histories.delete(ticker);
  if (found && Date.now() - found.loadedAt < lifetime) {
    histories.set(ticker, found);
    return found.days;
  }
  const days = getToken().then((token) => {
    if (!token) throw new Error('Your sign-in expired. Sign in again.');
    return fetchBrokers(ticker, token);
  });
  const entry = { loadedAt: Date.now(), days };
  histories.set(ticker, entry);
  for (const oldest of histories.keys()) {
    if (histories.size <= kept) break;
    histories.delete(oldest);
  }
  // Failures and tickers without broker data yet are asked for again next time.
  const forget = () => {
    if (histories.get(ticker) === entry) histories.delete(ticker);
  };
  days.then((loaded) => loaded.length || forget(), forget);
  return days;
}

export const clearBrokerHistory = () => histories.clear();
