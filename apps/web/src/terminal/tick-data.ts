import { useEffect, useMemo, useState } from 'react';
import type { BarFile, TickBook, TickKind, TickTrades } from '../ticks';
import { fetchBars, fetchTicks } from './sources.js';
import { useTerminal } from './state.js';

export type Loaded<K extends TickKind> = K extends 'book' ? TickBook : TickTrades;
export type TickState<K extends TickKind> =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: Loaded<K> };

// Past sessions never change, so every pane showing the same ticker and day shares one request.
const cache = new Map<string, Promise<TickBook | TickTrades | null>>();

export function loadTicks<K extends TickKind>(
  ticker: string,
  date: string,
  kind: K,
  getToken: () => Promise<string | undefined>,
): Promise<Loaded<K> | null> {
  const key = `${ticker}:${date}:${kind}`;
  let request = cache.get(key);
  if (!request) {
    request = getToken().then((token) => {
      if (!token) throw new Error('Your sign-in expired. Sign in again.');
      return fetchTicks(ticker, date, kind, token);
    });
    cache.set(key, request);
    void request.catch(() => cache.delete(key));
  }
  // fetchTicks validates the schema for this kind before the response enters the cache.
  return request as Promise<Loaded<K> | null>;
}

/** Sessions the ticker traded in 2026, and the one the tick panes show. */
export function useSession() {
  const { detail, tickDate, setTickDate } = useTerminal();
  const dates = useMemo(
    () =>
      detail.kind === 'ready'
        ? detail.data.prices.map((p) => p.date).filter((date) => date >= '2026-01-01')
        : [],
    [detail],
  );
  const date = tickDate && dates.includes(tickDate) ? tickDate : dates.at(-1);
  return { dates, date, setTickDate };
}

export function useTicks<K extends TickKind>(kind: K, date: string | undefined): TickState<K> {
  const { ticker, authState, getToken } = useTerminal();
  const signedIn = authState === 'signed-in';
  const [state, setState] = useState<TickState<K>>({ kind: 'loading' });
  useEffect(() => {
    if (!signedIn || !date) return;
    let current = true;
    setState({ kind: 'loading' });
    const request = loadTicks(ticker, date, kind, getToken);
    request.then(
      (data) => {
        if (current) setState(data ? { kind: 'ready', data } : { kind: 'missing' });
      },
      (error: unknown) => {
        if (current)
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Tick data is unavailable. Retry.',
          });
      },
    );
    return () => {
      current = false;
    };
  }, [ticker, date, kind, signedIn, getToken]);
  return state;
}

export type BarState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: BarFile };

// One file holds every collected session of a ticker, so each timeframe on GP shares one request.
const barCache = new Map<string, Promise<BarFile | null>>();
export const clearBars = () => barCache.clear();

function loadBars(
  ticker: string,
  getToken: () => Promise<string | undefined>,
): Promise<BarFile | null> {
  let request = barCache.get(ticker);
  if (!request) {
    request = getToken().then((token) => {
      if (!token) throw new Error('Your sign-in expired. Sign in again.');
      return fetchBars(ticker, token);
    });
    barCache.set(ticker, request);
    void request.catch(() => barCache.delete(ticker));
  }
  return request;
}

export function useBars(): BarState {
  const { ticker, authState, getToken } = useTerminal();
  const signedIn = authState === 'signed-in';
  const [state, setState] = useState<BarState>({ kind: 'loading' });
  useEffect(() => {
    if (!signedIn) return;
    let current = true;
    setState({ kind: 'loading' });
    loadBars(ticker, getToken).then(
      (data) => {
        if (current) setState(data ? { kind: 'ready', data } : { kind: 'missing' });
      },
      (error: unknown) => {
        if (current)
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Tick data is unavailable. Retry.',
          });
      },
    );
    return () => {
      current = false;
    };
  }, [ticker, signedIn, getToken]);
  return state;
}
