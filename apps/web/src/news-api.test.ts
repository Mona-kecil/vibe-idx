import { describe, expect, it } from 'vite-plus/test';
import { news } from '../api/news';

describe('public ticker news', () => {
  it('keeps RSS headlines as text and refuses arbitrary targets or malformed upstream feeds', async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      calls.push(input instanceof Request ? input.url : input.toString());
      return new Response(
        '<rss><channel><item><title>BBCA &amp; pasar</title><link>https://news.google.com/article</link><pubDate>Fri, 23 Oct 2026 01:00:00 GMT</pubDate><source url="https://example.com">Publisher</source></item></channel></rss>',
      );
    };
    const response = await news(new Request('https://vibe.test/api/news?ticker=BBCA'), fetcher);
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
    const source = new URL(calls[0] ?? '');
    expect(source.origin).toBe('https://news.google.com');
    expect(source.searchParams.get('q')).toBe('BBCA saham when:30d');
    for (const query of ['', '?ticker=../auth/stockbit', '?ticker=BBCA&ticker=BBRI'])
      expect((await news(new Request(`https://vibe.test/api/news${query}`), fetcher)).status).toBe(
        400,
      );
    expect(calls).toHaveLength(1);
    expect(
      (
        await news(
          new Request('https://vibe.test/api/news?ticker=BBCA', { method: 'POST' }),
          fetcher,
        )
      ).status,
    ).toBe(405);
    const failed: typeof fetch = async () => new Response('upstream unavailable', { status: 503 });
    expect((await news(new Request('https://vibe.test/api/news?ticker=BBCA'), failed)).status).toBe(
      502,
    );
    const unsafe: typeof fetch = async () =>
      new Response(
        '<rss><channel><item><title>Headline</title><link>javascript:alert(1)</link><pubDate>today</pubDate></item></channel></rss>',
      );
    expect((await news(new Request('https://vibe.test/api/news?ticker=BBCA'), unsafe)).status).toBe(
      502,
    );
  });
});
