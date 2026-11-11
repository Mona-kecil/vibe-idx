import { parseTickerCard } from './_share.js';

export async function loadTickerCard(ticker: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(
    `https://pub-7982bfb066694e6e8615750132283eba.r2.dev/ticker/${ticker}.json`,
    { signal: AbortSignal.timeout(10000) },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Ticker data returned ${response.status}`);
  const card = parseTickerCard(await response.json());
  return card?.ticker === ticker ? card : null;
}
