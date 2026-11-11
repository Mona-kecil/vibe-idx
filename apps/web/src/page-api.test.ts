import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vite-plus/test';
import { page } from '../api/page';
import history from './ticker/fixtures/TPIA-history.json';
import { reportFailure } from '../api/_sentry';

vi.mock('../api/_sentry', () => ({ reportFailure: vi.fn<typeof reportFailure>() }));
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function fixture(data: () => Response = () => Response.json(history)) {
  return vi.fn<typeof fetch>(async (input) => {
    if ((input instanceof Request ? input.url : input.toString()) === 'https://idx.test/index.html')
      return new Response(html);
    return data();
  });
}

describe('ticker page HTML', () => {
  it('injects a valid uppercase ticker and preserves the SPA', async () => {
    const fetcher = fixture();
    const response = await page(new Request('https://idx.test/api/page?ticker=tpia'), fetcher);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe(
      'public, s-maxage=300, stale-while-revalidate=3600',
    );
    expect(body).toContain('<title>TPIA ');
    expect(body).toContain('content="https://idx.test/t/TPIA"');
    expect(body).toContain('https://idx.test/api/og?ticker=TPIA&amp;d=');
    expect(body).toContain('<div id="root"></div>');
    expect(fetcher).toHaveBeenLastCalledWith(
      'https://pub-7982bfb066694e6e8615750132283eba.r2.dev/ticker/TPIA.json',
      expect.any(Object),
    );
  });

  it.each(['', '?ticker=BAD%2FNAME', '?ticker=TPIA&ticker=BBCA'])(
    'defaults for invalid parameters %s',
    async (query) => {
      const fetcher = fixture();
      const response = await page(new Request(`https://idx.test/api/page${query}`), fetcher);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<title>Vibe IDX</title>');
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([404, 503])('keeps the page available when ticker data returns %s', async (status) => {
    const response = await page(
      new Request('https://idx.test/api/page?ticker=NOPE'),
      fixture(() => new Response(null, { status })),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('content="https://idx.test/api/og"');
  });

  it('defaults when ticker data cannot be fetched', async () => {
    const response = await page(
      new Request('https://idx.test/api/page?ticker=TPIA'),
      fixture(() => {
        throw new Error('offline');
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>Vibe IDX</title>');
  });

  it('reports an unavailable index and returns 502', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    const response = await page(new Request('https://idx.test/api/page?ticker=TPIA'), fetcher);
    expect(response.status).toBe(502);
    expect(reportFailure).toHaveBeenCalledWith('page', expect.any(Error));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
