import './_workerd-satori.js';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { createElement as h, type CSSProperties } from 'react';
import satori, { init as initLayout, type Font } from 'satori/standalone';
import { areaChart, type Pad, type Tone } from '../src/area.js';
import { brokerTickerSchema } from '../src/brokers.js';
import { dateText, dayMove, nf } from '../src/ticker/format.js';
import { markSvg } from './_mark.js';
import type { TickerCard } from './_share.js';

type Wasm = WebAssembly.Module | BufferSource;
type Assets = { fetch(request: Request): Promise<Response> };

const fontFiles = [
  ['JetBrainsMono-500.ttf', 500],
  ['JetBrainsMono-700.ttf', 700],
] as const;

export function assetFonts(assets: Assets): () => Promise<Font[]> {
  let fonts: Promise<Font[]> | undefined;
  return () => {
    fonts ??= Promise.all(
      fontFiles.map(async ([file, weight]) => {
        const response = await assets.fetch(new Request(`https://assets.local/fonts/${file}`));
        if (!response.ok) throw new Error(`Font ${file} returned ${response.status}`);
        return { name: 'JetBrains Mono', data: await response.arrayBuffer(), weight };
      }),
    ).catch((error: unknown) => {
      fonts = undefined;
      throw error;
    });
    return fonts;
  };
}

const started = new Map<'layout' | 'resvg', Promise<void>>();

function startOnce(name: 'layout' | 'resvg', start: () => Promise<void>) {
  let promise = started.get(name);
  if (!promise) {
    promise = start().catch((error: unknown) => {
      started.delete(name);
      throw error;
    });
    started.set(name, promise);
  }
  return promise;
}

const bg = '#0a0c0b',
  head = '#141816',
  line = '#222826',
  ink = '#d9ded8',
  muted = '#8d9790';
const tones = { up: '#22a6a0', down: '#e4573f', flat: muted } satisfies Record<Tone, string>;
const color = (change: number | null) =>
  tones[change !== null && change > 0 ? 'up' : change !== null && change < 0 ? 'down' : 'flat'];

const mark = (size: number) =>
  h('img', {
    src: `data:image/svg+xml;base64,${Buffer.from(markSvg).toString('base64')}`,
    width: size,
    height: size,
  });

const chartSize = { width: 1104, height: 230, inset: 8 };
const chartPad: Pad = { top: 36, bottom: 36 };
const markerRadius = 5,
  markerGap = 11,
  markerBox = { width: 200, height: 24 };

export function windowLabel(start: string, end: string) {
  if (start === end) return dateText(end);
  return `${dateText(start, start.slice(0, 4) !== end.slice(0, 4))} – ${dateText(end)}`;
}

export function markerLayout(x: number, y: number, side: 'above' | 'below', width: number) {
  const { width: boxWidth, height: boxHeight } = markerBox,
    top = side === 'above' ? y - markerGap - boxHeight : y + markerGap;
  if (x - boxWidth / 2 < 0)
    return { left: Math.max(0, x - markerRadius), top, align: 'flex-start' };
  if (x + boxWidth / 2 > width)
    return {
      left: Math.min(width - boxWidth, x + markerRadius - boxWidth),
      top,
      align: 'flex-end',
    };
  return { left: x - boxWidth / 2, top, align: 'center' };
}

function areaBlock(card: TickerCard) {
  const { width, height, inset } = chartSize,
    area = areaChart(card.closes, width - 2 * inset, height, chartPad);
  if (!area) return null;
  const stroke = tones[area.tone],
    marks =
      area.high.value === area.low.value
        ? []
        : ([
            [area.high, 'above'],
            [area.low, 'below'],
          ] as const),
    gradient = { stopColor: stroke };
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'baseline', gap: 28, fontSize: 24 } },
      h('span', { style: { color: muted } }, windowLabel(card.start, card.date)),
    ),
    h(
      'div',
      { style: { display: 'flex', position: 'relative', width, height } },
      h(
        'svg',
        { width, height, viewBox: `${-inset} 0 ${width} ${height}` },
        h(
          'defs',
          null,
          h(
            'linearGradient',
            { id: 'area', x1: '0', y1: '0', x2: '0', y2: '1' },
            h('stop', { offset: '0%', ...gradient, stopOpacity: 0.35 }),
            h('stop', { offset: '100%', ...gradient, stopOpacity: 0 }),
          ),
        ),
        ...[0.25, 0.5, 0.75].map((f) =>
          h('path', {
            d: `M${-inset},${height * f} H${width - inset}`,
            stroke: line,
            strokeWidth: 1,
          }),
        ),
        h('path', { d: area.fill, fill: 'url(#area)' }),
        h('path', {
          d: area.line,
          fill: 'none',
          stroke,
          strokeWidth: 3,
          strokeLinejoin: 'round',
        }),
        ...marks.map(([point]) =>
          h('circle', {
            cx: point.x,
            cy: point.y,
            r: markerRadius,
            fill: ink,
            stroke: bg,
            strokeWidth: 2,
          }),
        ),
      ),
      ...marks.map(([point, side]) => {
        const { left, top, align } = markerLayout(point.x + inset, point.y, side, width);
        return h(
          'div',
          {
            style: {
              position: 'absolute',
              display: 'flex',
              alignItems: 'center',
              justifyContent: align,
              left,
              top,
              ...markerBox,
              fontSize: 20,
              color: muted,
            },
          },
          nf(point.value),
        );
      }),
    ),
  );
}

const root = {
  display: 'flex',
  flexDirection: 'column',
  width: 1200,
  height: 630,
  background: bg,
  color: ink,
  fontFamily: 'JetBrains Mono',
  fontWeight: 500,
} satisfies CSSProperties;

function brandCard() {
  return h(
    'div',
    { style: { ...root, justifyContent: 'center', padding: 88, gap: 40 } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 40, fontSize: 120, fontWeight: 700 } },
      mark(150),
      'Vibe IDX',
    ),
    h('div', { style: { fontSize: 30, color: muted } }, 'IDX prices, ownership and broker flow'),
  );
}

export function tickerCard(card: TickerCard) {
  const tickerSize = Math.min(112, 560 / (card.ticker.length * 0.6));
  return h(
    'div',
    { style: root },
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 72,
          padding: '0 48px',
          background: head,
          borderBottom: `1px solid ${line}`,
          fontSize: 24,
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 16, fontWeight: 700 } },
        mark(36),
        'Vibe IDX',
      ),
      h('div', { style: { color: muted } }, dateText(card.date)),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          padding: '44px 48px 0',
        },
      },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', width: 600 } },
        h(
          'div',
          { style: { fontSize: tickerSize, fontWeight: 700, lineHeight: 1, letterSpacing: -4 } },
          card.ticker,
        ),
        h(
          'div',
          {
            style: {
              fontSize: 32,
              color: muted,
              marginTop: 22,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            },
          },
          card.name,
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 14 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: 14, whiteSpace: 'nowrap' } },
          h('span', { style: { fontSize: 26, color: muted } }, 'IDR'),
          h(
            'span',
            { style: { fontSize: nf(card.close).length > 7 ? 52 : 64, fontWeight: 700 } },
            nf(card.close),
          ),
        ),
        h(
          'div',
          { style: { fontSize: 34, fontWeight: 700, color: color(card.changePct) } },
          dayMove(card.changePct),
        ),
      ),
    ),
    h(
      'div',
      { style: { display: 'flex', marginTop: 'auto', padding: '0 48px 36px' } },
      areaBlock(card),
    ),
  );
}

export function createCardRenderer({
  layout,
  resvg,
  fonts,
}: {
  layout: Wasm;
  resvg: Wasm;
  fonts: () => Promise<Font[]>;
}) {
  return async (card: TickerCard | null) => {
    const [loaded] = await Promise.all([
      fonts(),
      startOnce('layout', () => initLayout(layout)),
      startOnce('resvg', () => initWasm(resvg)),
    ]);
    const svg = await satori(card ? tickerCard(card) : brandCard(), {
      width: 1200,
      height: 630,
      fonts: loaded,
    });
    const resvgRender = new Resvg(svg);
    try {
      const image = resvgRender.render();
      try {
        return new Uint8Array(image.asPng());
      } finally {
        image.free();
      }
    } finally {
      resvgRender.free();
    }
  };
}

export function createOgHandler({
  render,
  loadCard,
  reportFailure = async () => {},
}: {
  render: (card: TickerCard | null) => Promise<Uint8Array<ArrayBuffer>>;
  loadCard: (ticker: string) => Promise<TickerCard | null>;
  reportFailure?: (route: string, failure: unknown) => Promise<void>;
}) {
  return async (request: Request) => {
    if (request.method !== 'GET')
      return new Response(null, { status: 405, headers: { Allow: 'GET' } });
    const search = new URL(request.url).searchParams;
    const parameters = search.getAll('ticker');
    const ticker =
      parameters.length === 0
        ? null
        : brokerTickerSchema.safeParse(
            parameters.length === 1 ? parameters[0]?.toUpperCase() : undefined,
          );
    if (ticker && !ticker.success)
      return Response.json({ error: 'invalid_ticker' }, { status: 400 });
    try {
      const card = ticker?.success ? await loadCard(ticker.data) : null;
      const png = await render(card);
      return new Response(png, {
        status: ticker && !card ? 404 : 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control':
            card && search.get('d') === card.date
              ? 'public, s-maxage=86400, stale-while-revalidate=604800'
              : 'public, s-maxage=3600',
        },
      });
    } catch (error) {
      await reportFailure('og', error);
      return Response.json({ error: 'unavailable' }, { status: 502 });
    }
  };
}
