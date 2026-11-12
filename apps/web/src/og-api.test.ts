import { describe, expect, it, vi } from 'vite-plus/test';
import type { ReactNode } from 'react';
import { loadFonts, markerLayout, og, renderCard, tickerCard, windowLabel } from '../api/og';
import type { TickerCard } from '../api/_share';
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

const card = (closes: number[], overrides: Partial<TickerCard> = {}): TickerCard => ({
  ticker: 'DEMO',
  name: 'Demo',
  date: '2026-11-12',
  start: '2026-08-14',
  close: closes.at(-1) ?? 0,
  changePct: 0.5,
  closes,
  ...overrides,
});
const ramp = (from: number, to: number) =>
  Array.from({ length: 60 }, (_, i) => from + ((to - from) * i) / 59);

function walk(node: ReactNode, found: { text: string[]; strokes: string[]; circles: number }) {
  if (Array.isArray(node)) return node.forEach((child) => walk(child, found));
  if (typeof node === 'string' || typeof node === 'number')
    return void found.text.push(String(node));
  if (!node || typeof node !== 'object' || !('props' in node)) return;
  const props = node.props as { children?: ReactNode; stroke?: string };
  if (node.type === 'circle') found.circles += 1;
  if (typeof props.stroke === 'string') found.strokes.push(props.stroke);
  walk(props.children, found);
}
const inspect = (value: TickerCard) => {
  const found = { text: [] as string[], strokes: [] as string[], circles: 0 };
  walk(tickerCard(value), found);
  return found;
};

describe('share card area chart', () => {
  it.each([
    ['rising', ramp(1000, 1200), '#22a6a0', '+20.00%'],
    ['falling', ramp(1000, 800), '#e4573f', '−20.00%'],
    ['flat', ramp(1000, 1000.5), '#8d9790', '+0.05%'],
  ])(
    'renders a %s series in its tone with the window range and only the day change',
    async (_, closes, stroke, change) => {
      const found = inspect(card(closes));
      expect(found.text).toContain('14 Aug – 12 Nov 2026');
      expect(found.text).not.toContain(change);
      expect(found.text).toContain('Up 0.50% today');
      expect(found.strokes).toContain(stroke);
      const png = await renderCard(card(closes), loadFonts);
      expect([...png.slice(0, 4)]).toEqual([137, 80, 78, 71]);
    },
  );

  it('marks the high and the low with their prices', () => {
    const found = inspect(card([100, 180, 90, 150]));
    expect(found.circles).toBe(2);
    expect(found.text).toEqual(expect.arrayContaining(['180', '90']));
  });

  it('marks nothing on a level series and still renders a single close', async () => {
    expect(inspect(card([50, 50, 50])).circles).toBe(0);
    const single = card([50], { start: '2026-11-12' });
    expect(inspect(single).text).toContain('12 Nov 2026');
    expect((await renderCard(single, loadFonts)).length).toBeGreaterThan(0);
  });

  it('shows the start year only when the window crosses a year', () => {
    expect(windowLabel('2026-08-14', '2026-11-12')).toBe('14 Aug – 12 Nov 2026');
    expect(windowLabel('2025-12-20', '2026-03-12')).toBe('20 Dec 2025 – 12 Mar 2026');
    expect(windowLabel('2026-11-12', '2026-11-12')).toBe('12 Nov 2026');
  });

  it.each([0, 3, 100, 552, 1000, 1050, 1101, 1104])(
    'keeps a marker label at x %i inside the card and beside its dot',
    (x) => {
      const { left, align } = markerLayout(x, 120, 'above', 1104);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + 200).toBeLessThanOrEqual(1104);
      expect(align).toBe(x < 100 ? 'flex-start' : x > 1004 ? 'flex-end' : 'center');
      const anchor = align === 'flex-start' ? left : align === 'flex-end' ? left + 200 : left + 100;
      expect(Math.abs(anchor - x)).toBeLessThanOrEqual(5);
    },
  );

  it('places the label above or below its point', () => {
    expect(markerLayout(500, 100, 'above', 1104).top).toBeLessThan(100);
    expect(markerLayout(500, 100, 'below', 1104).top).toBeGreaterThan(100);
  });
});
