import { describe, expect, it } from 'vite-plus/test';
import { createNewsHandler } from '../api/_news';

const now = Date.parse('2026-11-20T05:00:00Z');
const row = (n: number, published_at: string) => ({
  title: `Berita rekaan ${n}`,
  url: `https://news.example.test/${n}`,
  published_at,
  source: 'Kontan',
});
function handler(body: unknown, calls: string[] = []) {
  return createNewsHandler({
    now: () => now,
    store: async (key) => {
      calls.push(key);
      return body === undefined
        ? new Response(null, { status: 404 })
        : Response.json({ ticker: 'BBCA', as_of: '2026-11-20T00:00:00.000Z', news: body });
    },
  });
}
const get = (query: string, init?: RequestInit) =>
  new Request(`https://vibe.test/api/news?${query}`, init);

describe('ticker news from the archive', () => {
  it('answers the latest 20 within 30 days, newest first, from the ticker file only', async () => {
    const calls: string[] = [];
    const rows = [
      ...Array.from({ length: 25 }, (_, n) => row(n, new Date(now - n * 3600e3).toISOString())),
      row(99, new Date(now - 31 * 24 * 3600e3).toISOString()),
    ];
    const response = await handler(rows, calls)(get('ticker=BBCA&name=Untrusted'));
    expect(response.status).toBe(200);
    const items: { title: string }[] = await response.json();
    expect(items.map((item) => item.title)).toEqual(rows.slice(0, 20).map((r) => r.title));
    expect(await handler([rows[0]])(get('ticker=BBCA')).then((r) => r.json())).toEqual([
      {
        title: 'Berita rekaan 0',
        url: 'https://news.example.test/0',
        published_at: new Date(now).toISOString(),
        source: 'Kontan',
      },
    ]);
    expect(calls).toEqual(['news/ticker/BBCA/2026.json']);
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=900');
  });

  it('cuts a range at Jakarta midnights and caps it at 200', async () => {
    const edges = [
      row(1, '2026-08-10T16:59:59.000Z'),
      row(2, '2026-08-10T17:00:00.000Z'),
      row(3, '2026-10-01T16:59:59.000Z'),
      row(4, '2026-10-01T17:00:00.000Z'),
    ];
    const response = await handler([...edges].reverse())(
      get('ticker=BBCA&from=2026-08-11&to=2026-10-01'),
    );
    const items: { title: string }[] = await response.json();
    expect(items.map((item) => item.title)).toEqual(['Berita rekaan 3', 'Berita rekaan 2']);
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=86400');
    const many = Array.from({ length: 230 }, (_, n) => row(n, '2026-09-15T01:00:00.000Z'));
    expect(
      await handler(many)(get('ticker=BBCA&from=2026-09-01&to=2026-09-30')).then(
        async (r) => (await r.json()).length,
      ),
    ).toBe(200);
  });

  it('keeps a range that includes today short-lived and an old range outside 30 days', async () => {
    const old = [row(1, '2026-01-05T03:00:00.000Z')];
    const today = await handler(old)(get('ticker=BBCA&from=2026-01-01&to=2026-11-20'));
    expect(today.headers.get('Cache-Control')).toContain('s-maxage=900');
    expect(await today.json()).toHaveLength(1);
    expect(await handler(old)(get('ticker=BBCA')).then((r) => r.json())).toEqual([]);
  });

  it('answers an empty list for a ticker with no archived news', async () => {
    const response = await handler(undefined)(get('ticker=TLKM'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it('refuses arbitrary targets, bad ranges and other methods without reading the archive', async () => {
    const calls: string[] = [];
    const handle = handler([], calls);
    for (const query of [
      '',
      'ticker=../auth/stockbit',
      'ticker=BBCA&ticker=BBRI',
      'ticker=BBCA&from=2026-08-11',
      'ticker=BBCA&from=2026-10-01&to=2026-08-11',
      'ticker=BBCA&from=2025-01-01&to=2026-11-01',
    ])
      expect((await handle(get(query))).status).toBe(400);
    expect((await handle(get('ticker=BBCA', { method: 'POST' }))).status).toBe(405);
    expect(calls).toEqual([]);
  });

  it('reads each year a request touches and merges them newest first', async () => {
    const calls: string[] = [];
    const files: Record<string, ReturnType<typeof row>[]> = {
      '2026': [row(1, '2026-01-03T03:00:00.000Z')],
      '2025': [row(2, '2025-12-30T03:00:00.000Z'), row(3, '2025-06-01T03:00:00.000Z')],
    };
    const handle = createNewsHandler({
      now: () => Date.parse('2026-01-10T05:00:00Z'),
      store: async (key) => {
        calls.push(key);
        const rows = files[/(\d{4})\.json$/.exec(key)?.[1] ?? ''];
        return rows
          ? Response.json({ ticker: 'BBCA', as_of: '2026-01-10T00:00:00.000Z', news: rows })
          : new Response(null, { status: 404 });
      },
    });
    const items: { title: string }[] = await handle(get('ticker=BBCA')).then((r) => r.json());
    expect(items.map((item) => item.title)).toEqual(['Berita rekaan 1', 'Berita rekaan 2']);
    expect(calls.sort()).toEqual(['news/ticker/BBCA/2025.json', 'news/ticker/BBCA/2026.json']);
    calls.length = 0;
    await handle(get('ticker=BBCA&from=2026-01-02&to=2026-01-09'));
    expect(calls).toEqual(['news/ticker/BBCA/2026.json']);
    calls.length = 0;
    const wide = await handle(get('ticker=BBCA&from=2025-01-10&to=2026-01-10'));
    expect(calls.sort()).toEqual(['news/ticker/BBCA/2025.json', 'news/ticker/BBCA/2026.json']);
    expect((await wide.json()).length).toBe(3);
  });

  it.each([
    [
      'a failed read',
      () => Promise.reject(new Error('R2 down')),
      'news/ticker/BBCA/2026.json: read failed: R2 down',
    ],
    [
      'a server error',
      async () => new Response('no', { status: 500 }),
      'news/ticker/BBCA/2026.json: read failed: HTTP 500',
    ],
    [
      'text that is not JSON',
      async () => new Response('<html>'),
      'news/ticker/BBCA/2026.json: not JSON',
    ],
    [
      'a file of another shape',
      async () => Response.json({ news: [{ title: 'x' }] }),
      'news/ticker/BBCA/2026.json: unexpected shape at news.0.url',
    ],
  ])('answers 502 for %s and reports its cause once', async (_, store, cause) => {
    const heard: Error[] = [];
    const response = await createNewsHandler({ store, now: () => now })(get('ticker=BBCA'), (c) =>
      heard.push(c),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'unavailable' });
    expect(heard.map((c) => c.message)).toEqual([expect.stringContaining(cause)]);
  });
});
