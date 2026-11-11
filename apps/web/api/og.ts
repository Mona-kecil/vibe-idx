import { readFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { createElement as h, type CSSProperties } from 'react';
import satori, { type Font } from 'satori';
import { brokerTickerSchema } from '../src/brokers.js';
import { dateText, nf, signed } from '../src/ticker/format.js';
import { markSvg } from './_mark.js';
import { reportFailure } from './_sentry.js';
import { loadTickerCard } from './_share-data.js';
import type { TickerCard } from './_share.js';

let fonts: Promise<Font[]> | undefined;

export function loadFonts(): Promise<Font[]> {
  fonts ??= Promise.all([
    readFile(new URL('../public/fonts/JetBrainsMono-500.ttf', import.meta.url)),
    readFile(new URL('../public/fonts/JetBrainsMono-700.ttf', import.meta.url)),
  ])
    .then(
      ([medium, bold]) =>
        [
          { name: 'JetBrains Mono', data: medium, weight: 500 },
          { name: 'JetBrains Mono', data: bold, weight: 700 },
        ] satisfies Font[],
    )
    .catch((error: unknown) => {
      fonts = undefined;
      throw error;
    });
  return fonts;
}

const bg = '#0a0c0b',
  head = '#141816',
  line = '#222826',
  ink = '#d9ded8',
  muted = '#8d9790';
const color = (change: number | null) =>
  change !== null && change > 0 ? '#22a6a0' : change !== null && change < 0 ? '#e4573f' : muted;

const mark = (size: number) =>
  h('img', {
    src: `data:image/svg+xml;base64,${Buffer.from(markSvg).toString('base64')}`,
    width: size,
    height: size,
  });

function sparkline(closes: number[], width: number, height: number) {
  const first = closes[0],
    last = closes.at(-1);
  if (first === undefined || last === undefined) return null;
  const low = Math.min(...closes),
    high = Math.max(...closes),
    pad = 10;
  const points = closes.map((close, i) => [
    closes.length === 1 ? width / 2 : (i / (closes.length - 1)) * width,
    high === low ? height / 2 : pad + (1 - (close - low) / (high - low)) * (height - 2 * pad),
  ]);
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const stroke = color(last - first);
  return h(
    'svg',
    { width, height, viewBox: `0 0 ${width} ${height}` },
    h(
      'defs',
      null,
      h(
        'linearGradient',
        { id: 'area', x1: '0', y1: '0', x2: '0', y2: '1' },
        h('stop', { offset: '0%', stopColor: stroke, stopOpacity: 0.22 }),
        h('stop', { offset: '100%', stopColor: stroke, stopOpacity: 0 }),
      ),
    ),
    ...[0.25, 0.5, 0.75].map((f) =>
      h('path', { d: `M0,${height * f} H${width}`, stroke: line, strokeWidth: 1 }),
    ),
    h('path', {
      d: `${path} L${points.at(-1)?.[0]},${height} L${points[0]?.[0]},${height} Z`,
      fill: 'url(#area)',
    }),
    h('path', {
      d: path,
      fill: 'none',
      stroke,
      strokeWidth: 3,
      strokeLinejoin: 'round',
    }),
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

function tickerCard(card: TickerCard) {
  const tickerSize = Math.min(132, 560 / (card.ticker.length * 0.6));
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
              fontSize: 26,
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
            { style: { fontSize: nf(card.close).length > 7 ? 60 : 76, fontWeight: 700 } },
            nf(card.close),
          ),
        ),
        h(
          'div',
          { style: { fontSize: 38, fontWeight: 700, color: color(card.changePct) } },
          card.changePct === null ? '—' : `${signed(card.changePct, (v) => nf(v, 2))}%`,
        ),
      ),
    ),
    h(
      'div',
      { style: { display: 'flex', marginTop: 'auto', padding: '0 48px 40px' } },
      sparkline(card.closes, 1104, 190),
    ),
  );
}

export async function renderCard(card: TickerCard | null, fontLoader = loadFonts) {
  const svg = await satori(card ? tickerCard(card) : brandCard(), {
    width: 1200,
    height: 630,
    fonts: await fontLoader(),
  });
  return new Uint8Array(new Resvg(svg).render().asPng());
}

export async function og(
  request: Request,
  {
    fetcher = fetch,
    fontLoader = loadFonts,
  }: { fetcher?: typeof fetch; fontLoader?: typeof loadFonts } = {},
) {
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
  if (ticker && !ticker.success) return Response.json({ error: 'invalid_ticker' }, { status: 400 });
  try {
    const card = ticker?.success ? await loadTickerCard(ticker.data, fetcher) : null;
    const png = await renderCard(card, fontLoader);
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
}

export default { fetch: (request: Request) => og(request) };
