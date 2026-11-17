import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import resvg from '@resvg/resvg-wasm/index_bg.wasm';
import layout from 'satori/layout.wasm';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { ReactNode } from 'react';
import {
  assetFonts,
  createCardRenderer,
  createOgHandler,
  markerLayout,
  tickerCard,
  windowLabel,
} from '../api/_og';
import { harfbuzzBytes } from '../api/_workerd-satori';
import type { TickerCard } from '../api/_share';
import { parseTickerCard } from '../api/_share';
import history from './ticker/fixtures/TPIA-history.json';

const fontAssets = {
  fetch: async (request: Request) =>
    new Response(
      await readFile(new URL(`../public${new URL(request.url).pathname}`, import.meta.url)),
    ),
};

const render = createCardRenderer({ layout, resvg, fonts: assetFonts(fontAssets) });
const loaded = parseTickerCard(history);
const loadCard = vi.fn<(ticker: string) => Promise<TickerCard | null>>(async () => loaded);
const og = createOgHandler({ render, loadCard });

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
    loadCard.mockClear();
    const response = await og(new Request('https://idx.test/api/og'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=3600');
    await expectPng(response);
    expect(loadCard).not.toHaveBeenCalled();
  });

  it.each([
    [history.prices.at(-1)?.date ?? '', 'public, s-maxage=86400, stale-while-revalidate=604800'],
    ['2020-01-01', 'public, s-maxage=3600'],
    ['', 'public, s-maxage=3600'],
  ])('renders a ticker with the date cache policy for %s', async (date, cache) => {
    loadCard.mockClear();
    const response = await og(new Request(`https://idx.test/api/og?ticker=tpia&d=${date}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(cache);
    await expectPng(response);
    expect(loadCard).toHaveBeenCalledWith('TPIA');
  });

  it('renders the brand with 404 for an unknown ticker', async () => {
    const unknown = await createOgHandler({ render, loadCard: async () => null })(
      new Request('https://idx.test/api/og?ticker=NOPE'),
    );
    const brand = await og(new Request('https://idx.test/api/og'));
    expect(unknown.status).toBe(404);
    expect(await expectPng(unknown)).toEqual(await expectPng(brand));
  });

  it.each(['?ticker=', '?ticker=..%2Fprivate', '?ticker=TPIA&ticker=BBCA'])(
    'rejects bad ticker parameters %s',
    async (query) => {
      const renderer = vi.fn<typeof render>();
      const lookup = vi.fn<typeof loadCard>();
      const response = await createOgHandler({ render: renderer, loadCard: lookup })(
        new Request(`https://idx.test/api/og${query}`),
      );
      expect(response.status).toBe(400);
      expect(lookup).not.toHaveBeenCalled();
      expect(renderer).not.toHaveBeenCalled();
    },
  );

  it('reports rendering failures with 502', async () => {
    const reportFailure = vi.fn<(route: string, failure: unknown) => Promise<void>>(async () => {});
    const failing = createOgHandler({
      render: createCardRenderer({
        layout,
        resvg,
        fonts: () => Promise.reject(new Error('Fonts unavailable')),
      }),
      loadCard,
      reportFailure,
    });
    const response = await failing(new Request('https://idx.test/api/og'));
    expect(response.status).toBe(502);
    expect(reportFailure).toHaveBeenCalledWith('og', expect.any(Error));
  });

  it('reports data outages with 502 instead of caching an unknown ticker', async () => {
    const response = await createOgHandler({
      render,
      loadCard: () => Promise.reject(new Error('Ticker data returned 503')),
    })(new Request('https://idx.test/api/og?ticker=TPIA'));
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBeNull();
  });
});

describe('workerd HarfBuzz', () => {
  it("is the HarfBuzz module satori bundles, so the Worker can instantiate it in satori's place", async () => {
    const require = createRequire(import.meta.url);
    const bundled = await readFile(
      require.resolve('satori/standalone').replace(/\.cjs$/, '.js'),
      'utf8',
    );
    const base64 = bundled.match(/"(AGFzbQ[A-Za-z0-9+/=]{1000,})"/)?.[1] ?? '';
    const bytes = Buffer.from(base64, 'base64');
    expect(bytes.length).toBe(harfbuzzBytes);
    expect(bytes.equals(await readFile(require.resolve('harfbuzzjs/hb.wasm')))).toBe(true);
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
      const png = await render(card(closes));
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
    expect((await render(single)).length).toBeGreaterThan(0);
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
