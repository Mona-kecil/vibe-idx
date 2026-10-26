import { XMLBuilder } from 'fast-xml-parser';
import { describe, expect, it, vi } from 'vite-plus/test';
import { news } from '../api/news';

function feed(items: { title: string; link: string; pubDate: string; source?: string }[]) {
  return new Response(new XMLBuilder().build({ rss: { channel: { item: items } } }));
}

describe('public ticker news', () => {
  it('drops unrelated SINI headlines before either cap and uses only the ticker when company lookup fails', async () => {
    const tickerTitles = [
      'Saham SINI Ditekan Aksi Jual Investor Asing Pekan Ini',
      'Rencana Akuisisi SINI?',
      'Emiten (SINI) Umumkan RUPS',
      'SINI, Saham Pilihan',
    ];
    const companyTitles = ['Singaraja Putra Umumkan RUPS', 'ＳＩＮＧＡＲＡＪＡ—putra: Dividen'];
    const unrelatedTitles = [
      '5 Saham Ini Potensial untuk Scalping',
      'Bupati Buleleng Cup 2026: Putra Kubutambahan',
      'Pilihan saham sini',
      'SINIX naik',
      'XSINI naik',
      'Singaraja Putranya Umumkan RUPS',
      'Pesingaraja Putra Umumkan RUPS',
    ];
    for (const companyAvailable of [true, false]) {
      for (const [range, limit] of [
        ['', 20],
        ['&from=2026-10-23&to=2026-10-23', 200],
      ] as const) {
        const fetcher: typeof fetch = async (input) => {
          const url = new URL(input instanceof Request ? input.url : input.toString());
          if (url.pathname === '/ticker/SINI.json')
            return companyAvailable
              ? Response.json({ ticker: 'SINI', name: 'PT Singaraja Putra Tbk.' })
              : new Response(null, { status: 404 });
          return feed(
            [
              ...Array.from({ length: limit }, (_, index) => `Pilihan saham sini ${index}`),
              ...unrelatedTitles,
              ...tickerTitles,
              ...companyTitles,
            ].map((title, index) => ({
              title,
              link: `https://news.google.com/${index}`,
              pubDate: '2026-10-23T01:00:00Z',
            })),
          );
        };
        const response = await news(
          new Request(`https://vibe.test/api/news?ticker=SINI${range}`),
          fetcher,
        );
        expect(response.status).toBe(200);
        const items: { title: string }[] = await response.json();
        expect(items.map((item) => item.title)).toEqual([
          ...tickerTitles,
          ...(companyAvailable ? companyTitles : []),
        ]);
      }
    }
  });

  it('uses the published company name instead of client input and refuses arbitrary targets', async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      calls.push(input instanceof Request ? input.url : input.toString());
      if (calls.at(-1)?.endsWith('/ticker/BBCA.json'))
        return Response.json({ ticker: 'BBCA', name: 'PT Bank Central Asia Tbk.' });
      return new Response(
        '<rss><channel><item><title>BBCA &amp; pasar</title><link>https://news.google.com/article</link><pubDate>Fri, 23 Oct 2026 01:00:00 GMT</pubDate><source url="https://example.com">Publisher</source></item></channel></rss>',
      );
    };
    const response = await news(
      new Request('https://vibe.test/api/news?ticker=BBCA&name=Untrusted'),
      fetcher,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        title: 'BBCA & pasar',
        url: 'https://news.google.com/article',
        published_at: 'Fri, 23 Oct 2026 01:00:00 GMT',
        source: 'Publisher',
      },
    ]);
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=900');
    expect(calls[0]).toBe('https://pub-7982bfb066694e6e8615750132283eba.r2.dev/ticker/BBCA.json');
    const source = new URL(calls[1] ?? '');
    expect(source.origin).toBe('https://news.google.com');
    expect(source.searchParams.get('q')).toBe(
      '("saham BBCA" OR "BBCA saham" OR "Bank Central Asia") when:30d',
    );
    for (const query of ['', '?ticker=../auth/stockbit', '?ticker=BBCA&ticker=BBRI'])
      expect((await news(new Request(`https://vibe.test/api/news${query}`), fetcher)).status).toBe(
        400,
      );
    expect(calls).toHaveLength(2);
    expect(
      (
        await news(
          new Request('https://vibe.test/api/news?ticker=BBCA', { method: 'POST' }),
          fetcher,
        )
      ).status,
    ).toBe(405);
  });

  it('merges parallel month windows without leaking Jakarta boundary dates or duplicate headlines', async () => {
    const queries: string[] = [];
    const pending: (() => void)[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === '/ticker/SINI.json')
        return Response.json({ ticker: 'SINI', name: 'PT Singaraja Putra (Persero) Tbk.' });
      const index = queries.length;
      queries.push(url.searchParams.get('q') ?? '');
      await new Promise<void>((resolve) => pending.push(resolve));
      const items = [
        {
          title: 'SINI Before first Jakarta date',
          link: 'https://news.google.com/before',
          pubDate: '2026-08-10T16:59:59Z',
        },
        {
          title: 'SINI First Jakarta midnight',
          link: 'https://news.google.com/first',
          pubDate: '2026-08-10T17:00:00Z',
        },
        {
          title: 'SINI & acquisition',
          link: 'https://news.google.com/acquisition',
          pubDate: '2026-08-15T01:00:00Z',
          source: 'Publisher',
        },
        {
          title: 'SINI Different title with the same link',
          link: 'https://news.google.com/acquisition',
          pubDate: '2026-08-14T01:00:00Z',
        },
        {
          title: '  SINI — ACQUISITION! ',
          link: 'https://news.google.com/duplicate-title',
          pubDate: '2026-08-13T01:00:00Z',
          source: ' PUBLISHER ',
        },
        {
          title: 'SINI & acquisition',
          link: 'https://news.google.com/another-publisher',
          pubDate: '2026-08-12T01:00:00Z',
          source: 'Another Publisher',
        },
        {
          title: 'SINI Last Jakarta second',
          link: 'https://news.google.com/last',
          pubDate: '2026-10-01T16:59:59Z',
        },
        {
          title: 'SINI After last Jakarta date',
          link: 'https://news.google.com/after',
          pubDate: '2026-10-01T17:00:00Z',
        },
      ];
      return feed(
        index === 0 ? items.slice(0, 3) : index === 1 ? items.slice(2, 6) : items.slice(6),
      );
    };
    const request = news(
      new Request('https://vibe.test/api/news?ticker=SINI&from=2026-08-11&to=2026-10-01'),
      fetcher,
    );
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    pending.forEach((resolve) => resolve());
    const response = await request;
    expect(response.status).toBe(200);
    expect(queries).toEqual(
      [
        'after:2026-08-10 before:2026-09-01',
        'after:2026-08-31 before:2026-10-01',
        'after:2026-09-30 before:2026-10-02',
      ].map((window) => `("saham SINI" OR "SINI saham" OR "Singaraja Putra") ${window}`),
    );
    expect(await response.json()).toEqual([
      {
        title: 'SINI Last Jakarta second',
        url: 'https://news.google.com/last',
        published_at: '2026-10-01T16:59:59Z',
        source: 'Google News',
      },
      {
        title: 'SINI & acquisition',
        url: 'https://news.google.com/acquisition',
        published_at: '2026-08-15T01:00:00Z',
        source: 'Publisher',
      },
      {
        title: 'SINI & acquisition',
        url: 'https://news.google.com/another-publisher',
        published_at: '2026-08-12T01:00:00Z',
        source: 'Another Publisher',
      },
      {
        title: 'SINI First Jakarta midnight',
        url: 'https://news.google.com/first',
        published_at: '2026-08-10T17:00:00Z',
        source: 'Google News',
      },
    ]);
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=86400');
  });

  it('rejects incomplete, duplicate, impossible, reversed, or overlong ranges before fetching', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const range of [
      'from=2026-08-11',
      'to=2026-08-23',
      'from=&to=',
      'from=2026-8-11&to=2026-08-23',
      'from=2026-02-29&to=2026-03-01',
      'from=2026-08-11T00:00:00Z&to=2026-08-23',
      'from=2026-08-23&to=2026-08-11',
      'from=2026-01-01&to=2027-01-02',
      'from=2026-08-11&from=2026-08-12&to=2026-08-23',
      'from=2026-08-11&to=2026-08-23&to=2026-08-24',
    ]) {
      const response = await news(
        new Request(`https://vibe.test/api/news?ticker=SINI&${range}`),
        fetcher,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_range' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps unknown tickers working, sorts before capping, and expires current ranges on Jakarta time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T18:00:00Z'));
    try {
      const queries: string[] = [];
      const fetcher: typeof fetch = async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname === '/ticker/UNKNOWN.json') return new Response(null, { status: 404 });
        queries.push(url.searchParams.get('q') ?? '');
        return feed(
          Array.from({ length: 205 }, (_, index) => ({
            title: `UNKNOWN Headline ${index}`,
            link: `https://news.google.com/${index}`,
            pubDate: new Date(Date.parse('2026-10-25T00:00:00Z') + index * 1000).toISOString(),
          })),
        );
      };
      for (const [range, limit, cache] of [
        ['', 20, 900],
        ['&from=2026-10-25&to=2026-10-25', 200, 86400],
        ['&from=2026-10-25&to=2026-10-26', 200, 900],
        ['&from=2026-01-01&to=2027-01-01', 200, 900],
      ] as const) {
        const response = await news(
          new Request(`https://vibe.test/api/news?ticker=UNKNOWN${range}`),
          fetcher,
        );
        expect(response.status).toBe(200);
        const items: { title: string }[] = await response.json();
        expect(items).toHaveLength(limit);
        expect(items[0]?.title).toBe('UNKNOWN Headline 204');
        expect(items.at(-1)?.title).toBe(`UNKNOWN Headline ${205 - limit}`);
        expect(response.headers.get('Cache-Control')).toContain(`s-maxage=${cache}`);
      }
      expect(queries[0]).toBe('UNKNOWN saham when:30d');
      expect(queries[1]).toBe('UNKNOWN saham after:2026-10-24 before:2026-10-26');
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the ticker query when the company lookup fails', async () => {
    for (const lookup of [
      () => Response.json({ ticker: 'BBCA', name: 'Stale Company' }, { status: 503 }),
      () => Promise.reject(new Error('Network failure')),
      () => new Response('{not json'),
      () => Response.json({ ticker: 'BBRI', name: 'Bank Rakyat Indonesia' }),
    ]) {
      const queries: string[] = [];
      const fetcher: typeof fetch = async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname === '/ticker/BBCA.json') return lookup();
        queries.push(url.searchParams.get('q') ?? '');
        return feed([
          { title: 'BBCA Headline', link: 'https://news.google.com/item', pubDate: '2026-08-12' },
        ]);
      };
      const response = await news(new Request('https://vibe.test/api/news?ticker=BBCA'), fetcher);
      expect(response.status).toBe(200);
      expect(queries).toEqual(['BBCA saham when:30d']);
    }
  });

  it('returns 502 for RSS failures, unsafe links, and invalid publication dates', async () => {
    for (const upstream of [
      () => new Response('unavailable', { status: 503 }),
      () => new Response('<not-rss/>'),
      () => feed([{ title: 'Headline', link: 'javascript:alert(1)', pubDate: '2026-08-11' }]),
      () => feed([{ title: 'Headline', link: 'https://news.google.com/item', pubDate: 'invalid' }]),
      () => Promise.reject(new Error('Network failure')),
    ]) {
      const fetcher: typeof fetch = async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname === '/ticker/BBCA.json') return new Response(null, { status: 404 });
        if (url.searchParams.get('q')?.includes('after:2026-08-10'))
          return feed([
            { title: 'Headline', link: 'https://news.google.com/item', pubDate: '2026-08-12' },
          ]);
        return upstream();
      };
      const response = await news(
        new Request('https://vibe.test/api/news?ticker=BBCA&from=2026-08-11&to=2026-09-23'),
        fetcher,
      );
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'unavailable' });
    }
    const failed: typeof fetch = async () => new Response('unavailable', { status: 503 });
    expect((await news(new Request('https://vibe.test/api/news?ticker=BBCA'), failed)).status).toBe(
      502,
    );
  });
});
