export type CacheStore = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};
type Fail = (error: unknown) => void;

// The zone's Browser Cache TTL rewrites Cache-Control on cached responses to 4 hours, and workerd
// ignores s-maxage, so a stored copy expires by its max-age and the response's own Cache-Control
// travels in this header, to be restored on a hit.
const sourceCacheControl = 'X-Source-Cache-Control';

function withHeaders(response: Response, edit: (headers: Headers) => void) {
  const headers = new Headers(response.headers);
  edit(headers);
  return new Response(response.body, { status: response.status, headers });
}

/**
 * The data center's cache for public responses. A failing cache costs a render or a read from R2,
 * never the request, and each failure is passed to `fail`.
 */
export function createEdgeCache(
  cache: () => CacheStore,
  waitUntil: (promise: Promise<unknown>) => void,
  fail: Fail,
) {
  return {
    /** The stored response with its own Cache-Control back and X-Edge-Cache: HIT, or undefined. */
    async get(key: Request) {
      let hit: Response | undefined;
      try {
        hit = await cache().match(key);
      } catch (error) {
        fail(error);
      }
      if (!hit) return undefined;
      return withHeaders(hit, (headers) => {
        headers.set('Cache-Control', headers.get(sourceCacheControl) ?? '');
        headers.delete(sourceCacheControl);
        headers.set('X-Edge-Cache', 'HIT');
      });
    },
    /** Keeps a copy of the response for the max-age in `storedCacheControl`, without delaying it. */
    put(key: Request, response: Response, storedCacheControl: string) {
      waitUntil(
        (async () => {
          try {
            await cache().put(
              key,
              withHeaders(response.clone(), (headers) => {
                headers.set(sourceCacheControl, headers.get('Cache-Control') ?? '');
                headers.set('Cache-Control', storedCacheControl);
              }),
            );
          } catch (error) {
            fail(error);
          }
        })(),
      );
    },
  };
}

export type EdgeCache = ReturnType<typeof createEdgeCache>;

function sMaxAge(response: Response) {
  const match = /(?:^|[\s,])s-maxage=(\d+)/.exec(response.headers.get('Cache-Control') ?? '');
  return match ? Number(match[1]) : 0;
}

/**
 * Only the ticker and the date change a Ticker card, so every other parameter is dropped and the
 * ticker upper-cased. The date counts only in the form the card compares it in, and only with a ticker.
 */
export function cardKey(url: URL) {
  const key = new URL('/api/og', url);
  const tickers = url.searchParams.getAll('ticker');
  for (const ticker of tickers) key.searchParams.append('ticker', ticker.toUpperCase());
  const date = url.searchParams.get('d');
  if (tickers.length > 0 && date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date))
    key.searchParams.set('d', date);
  return new Request(key);
}

// Caches only 200 responses that declare an s-maxage. 400, 404 and 5xx pass through.
export async function edgeCachedResponse(
  key: Request,
  edge: EdgeCache,
  produce: () => Promise<Response>,
  maxAge = Infinity,
) {
  const hit = await edge.get(key);
  if (hit) return hit;
  const response = await produce();
  const ttl = response.status === 200 ? Math.min(sMaxAge(response), maxAge) : 0;
  if (ttl > 0) edge.put(key, response, `public, max-age=${ttl}`);
  return withHeaders(response, (headers) =>
    headers.set('X-Edge-Cache', ttl > 0 ? 'MISS' : 'BYPASS'),
  );
}

/** Only these parameters affect news; keep duplicates so invalid requests cannot hit valid entries. */
export function newsKey(url: URL) {
  const key = new URL('/api/news', url);
  for (const name of ['ticker', 'from', 'to'])
    for (const value of url.searchParams.getAll(name)) key.searchParams.append(name, value);
  return new Request(key);
}
