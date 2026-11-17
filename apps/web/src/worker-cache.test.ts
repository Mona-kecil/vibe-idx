import { describe, expect, it, vi } from 'vite-plus/test';
import { cardKey, createEdgeCache, edgeCachedCard } from '../worker-cache';

// Expires entries by max-age alone, as workerd's Cache API does.
function memoryCache() {
  const stored = new Map<string, { response: Response; expires: number }>();
  let now = 0;
  return {
    stored,
    advance: (seconds: number) => (now += seconds * 1000),
    async match(request: Request) {
      const entry = stored.get(request.url);
      if (!entry || entry.expires <= now) return undefined;
      return entry.response.clone();
    },
    async put(request: Request, response: Response) {
      const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('Cache-Control') ?? '')?.[1]);
      stored.set(request.url, { response, expires: now + maxAge * 1000 });
    },
  };
}

function setup() {
  const cache = memoryCache();
  const pending: Promise<unknown>[] = [];
  const fail = vi.fn<(error: unknown) => void>();
  const edge = createEdgeCache(() => cache, (promise) => pending.push(promise), fail);
  const run = (url: string, produce: () => Promise<Response>) =>
    edgeCachedCard(new Request(url), edge, produce);
  return { cache, edge, fail, run, settle: () => Promise.all(pending) };
}

const card =
  (cacheControl: string, status = 200) =>
  async () =>
    new Response('png', { status, headers: { 'Cache-Control': cacheControl } });
const policy = 'public, s-maxage=86400, stale-while-revalidate=604800';

describe('edge cache', () => {
  it('serves a repeat request from the cache with the browser-facing Cache-Control unchanged', async () => {
    const { run, settle } = setup();
    const produce = vi.fn<() => Promise<Response>>(card(policy));
    const first = await run('https://idx.test/api/og?ticker=BBCA&d=2026-11-12', produce);
    await settle();
    const second = await run('https://idx.test/api/og?ticker=BBCA&d=2026-11-12', produce);
    expect(first.headers.get('X-Edge-Cache')).toBe('MISS');
    expect(second.headers.get('X-Edge-Cache')).toBe('HIT');
    expect(await second.text()).toBe('png');
    expect(second.headers.get('Cache-Control')).toBe(policy);
    expect(second.headers.has('X-Source-Cache-Control')).toBe(false);
    expect(produce).toHaveBeenCalledOnce();
  });

  it('renders another ticker or date as its own card', async () => {
    const { run, settle } = setup();
    const produce = vi.fn<() => Promise<Response>>(card(policy));
    const queries = ['ticker=BBCA&d=2026-11-12', 'ticker=BBRI&d=2026-11-12', 'ticker=BBCA&d=2026-11-13'];
    for (const query of queries) await run(`https://idx.test/api/og?${query}`, produce);
    await settle();
    for (const query of queries)
      expect(
        (await run(`https://idx.test/api/og?${query}`, produce)).headers.get('X-Edge-Cache'),
      ).toBe('HIT');
    expect(produce).toHaveBeenCalledTimes(3);
  });

  it('expires after the s-maxage', async () => {
    const { cache, run, settle } = setup();
    const produce = vi.fn<() => Promise<Response>>(card('public, s-maxage=3600'));
    await run('https://idx.test/api/og', produce);
    await settle();
    cache.advance(3599);
    expect((await run('https://idx.test/api/og', produce)).headers.get('X-Edge-Cache')).toBe('HIT');
    cache.advance(2);
    expect((await run('https://idx.test/api/og', produce)).headers.get('X-Edge-Cache')).toBe(
      'MISS',
    );
  });

  it.each([400, 404, 500, 502])('never stores a %i response', async (status) => {
    const { cache, run, settle } = setup();
    const response = await run('https://idx.test/api/og', card('public, s-maxage=3600', status));
    await settle();
    expect(response.status).toBe(status);
    expect(response.headers.get('X-Edge-Cache')).toBe('BYPASS');
    expect(cache.stored.size).toBe(0);
  });

  it('never stores a response without an s-maxage', async () => {
    const { cache, run, settle } = setup();
    await run('https://idx.test/api/og', card('no-store'));
    await settle();
    expect(cache.stored.size).toBe(0);
  });

  it('renders anyway and reports when the cache fails', async () => {
    const { cache, fail, run, settle } = setup();
    const broken = new Error('cache down');
    cache.match = async () => Promise.reject(broken);
    cache.put = async () => Promise.reject(broken);
    const response = await run('https://idx.test/api/og', card(policy));
    await settle();
    expect(response.status).toBe(200);
    expect(fail).toHaveBeenCalledTimes(2);
    expect(fail).toHaveBeenCalledWith(broken);
  });

  it('stores any response for the max-age it is given and restores its own Cache-Control', async () => {
    const { cache, edge, settle } = setup();
    const key = new Request('https://idx.test/data/market.json');
    const original = 'public, max-age=60';
    edge.put(key, new Response('{}', { headers: { 'Cache-Control': original } }), original);
    await settle();
    cache.advance(59);
    const hit = await edge.get(key);
    expect(hit?.headers.get('Cache-Control')).toBe(original);
    expect(hit?.headers.get('X-Edge-Cache')).toBe('HIT');
    cache.advance(2);
    expect(await edge.get(key)).toBeUndefined();
  });
});

describe('card key', () => {
  const key = (query: string) => cardKey(new URL(`https://idx.test/api/og?${query}`)).url;

  it('is the upper-cased ticker and the date, in a fixed order', () => {
    expect(key('d=2026-11-12&ticker=bbca')).toBe(
      'https://idx.test/api/og?ticker=BBCA&d=2026-11-12',
    );
  });

  it('ignores every other parameter and the fragment', () => {
    const plain = key('ticker=BBCA&d=2026-11-12');
    expect(key('ticker=BBCA&d=2026-11-12&utm_source=chat&cb=1')).toBe(plain);
    expect(cardKey(new URL('https://idx.test/api/og?ticker=BBCA&d=2026-11-12#x')).url).toBe(plain);
  });

  it('drops a date that cannot match any card, so a made-up one forces no render', () => {
    expect(key('ticker=BBCA&d=junk')).toBe(key('ticker=BBCA'));
    expect(key('ticker=BBCA&d=')).toBe(key('ticker=BBCA'));
  });

  it('shares one brand card among all requests without a ticker', () => {
    expect(key('')).toBe(key('d=2026-11-12&x=1'));
  });

  it('keeps repeated tickers apart from a single one', () => {
    expect(key('ticker=BBCA&ticker=BBRI')).not.toBe(key('ticker=BBCA'));
  });
});
