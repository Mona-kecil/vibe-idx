import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TickBook, TickKind, TickTrades } from '../ticks';
import { fetchTicks } from './sources';
import { useTerminal } from './state';

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

export function useTradeSessions(batchSize: number) {
  const { ticker, authState, getToken } = useTerminal();
  const { dates } = useSession();
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: TickTrades[] }
  >({ kind: 'loading' });
  const requestMore = useRef<() => void>(() => {});
  const loadMore = useCallback(() => requestMore.current(), []);
  useEffect(() => {
    if (authState !== 'signed-in') return;
    let current = true;
    let loading = false;
    let exhausted = false;
    let cursor = dates.length;
    function load() {
      if (!current || loading || exhausted) return;
      loading = true;
      const start = Math.max(0, cursor - batchSize);
      void Promise.all(
        dates.slice(start, cursor).map((date) => loadTicks(ticker, date, 'trades', getToken)),
      )
        .then((sessions) => {
          if (!current) return;
          cursor = start;
          // A whole missing batch marks the end of collected history, even if daily prices go further back.
          exhausted = start === 0 || sessions.every((data) => data === null);
          const older = sessions.filter((data) => data !== null);
          setState((previous) => ({
            kind: 'ready',
            data: [...older, ...(previous.kind === 'ready' ? previous.data : [])],
          }));
        })
        .catch((error: unknown) => {
          if (current)
            setState({
              kind: 'error',
              message: error instanceof Error ? error.message : 'Tick data is unavailable. Retry.',
            });
        })
        .finally(() => {
          loading = false;
        });
    }
    requestMore.current = load;
    setState({ kind: 'loading' });
    load();
    return () => {
      current = false;
      requestMore.current = () => {};
    };
  }, [ticker, authState, getToken, dates, batchSize]);
  return { state, loadMore };
}
