import { parseTickerCard } from './_share.js';

export async function loadBucketTickerCard(
  bucket: { get(key: string): Promise<{ body: ReadableStream } | null> },
  ticker: string,
) {
  const object = await bucket.get(`ticker/${ticker}.json`);
  const card = object ? parseTickerCard(await new Response(object.body).json()) : null;
  return card?.ticker === ticker ? card : null;
}
