import { describe, expect, it, vi } from 'vite-plus/test';
import { loadFonts, og } from '../api/og';
import { reportFailure } from '../api/_sentry';
import history from './ticker/fixtures/TPIA-history.json';

vi.mock('../api/_sentry', () => ({ reportFailure: vi.fn<typeof reportFailure>() }));

const fontLoader = loadFonts;

async function expectPng(response: Response) {
  expect(response.headers.get('content-type')).toBe('image/png');
  const bytes = await response.arrayBuffer();
  expect([...new Uint8Array(bytes).slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const data = new DataView(bytes);
  expect(data.getUint32(16)).toBe(1200);
  expect(data.getUint32(20)).toBe(630);
  return bytes;
}

describe('share card PNGs', () => {
  it('renders the brand without a ticker lookup', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await og(new Request('https://idx.test/api/og'), { fetcher, fontLoader });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=3600');
    await expectPng(response);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [history.prices.at(-1)?.date ?? '', 'public, s-maxage=86400, stale-while-revalidate=604800'],
    ['2020-01-01', 'public, s-maxage=3600'],
    ['', 'public, s-maxage=3600'],
  ])('renders a ticker with the date cache policy for %s', async (date, cache) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(history));
    const response = await og(new Request(`https://idx.test/api/og?ticker=tpia&d=${date}`), {
      fetcher,
      fontLoader,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(cache);
    await expectPng(response);
    expect(fetcher).toHaveBeenCalledWith(
      'https://pub-7982bfb066694e6e8615750132283eba.r2.dev/ticker/TPIA.json',
      expect.any(Object),
    );
  });

  it('renders the brand with 404 for an unknown ticker', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    const unknown = await og(new Request('https://idx.test/api/og?ticker=NOPE'), {
      fetcher,
      fontLoader,
    });
    const brand = await og(new Request('https://idx.test/api/og'), { fetcher, fontLoader });
    expect(unknown.status).toBe(404);
    expect(await expectPng(unknown)).toEqual(await expectPng(brand));
  });

  it.each(['?ticker=', '?ticker=..%2Fprivate', '?ticker=TPIA&ticker=BBCA'])(
    'rejects bad ticker parameters %s',
    async (query) => {
      const fetcher = vi.fn<typeof fetch>();
      const loader = vi.fn<typeof fontLoader>();
      const response = await og(new Request(`https://idx.test/api/og${query}`), {
        fetcher,
        fontLoader: loader,
      });
      expect(response.status).toBe(400);
      expect(fetcher).not.toHaveBeenCalled();
      expect(loader).not.toHaveBeenCalled();
    },
  );

  it('reports rendering failures with 502', async () => {
    const response = await og(new Request('https://idx.test/api/og'), {
      fontLoader: () => Promise.reject(new Error('Fonts unavailable')),
    });
    expect(response.status).toBe(502);
    expect(reportFailure).toHaveBeenCalledWith('og', expect.any(Error));
  });

  it('reports data outages with 502 instead of caching an unknown ticker', async () => {
    const response = await og(new Request('https://idx.test/api/og?ticker=TPIA'), {
      fetcher: async () => new Response(null, { status: 503 }),
      fontLoader,
    });
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBeNull();
  });
});
