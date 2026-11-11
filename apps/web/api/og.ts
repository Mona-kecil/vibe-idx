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
    readFile(new URL('../public/fonts/Manrope-500.ttf', import.meta.url)),
    readFile(new URL('../public/fonts/Manrope-800.ttf', import.meta.url)),
  ])
    .then(
      ([medium, bold]) =>
        [
          { name: 'Manrope', data: medium, weight: 500 },
          { name: 'Manrope', data: bold, weight: 800 },
        ] satisfies Font[],
    )
    .catch((error: unknown) => {
      fonts = undefined;
      throw error;
    });
  return fonts;
}

const paper = '#f8f7f3',
  ink = '#222320',
  muted = '#62635c';
const color = (change: number | null) =>
  change !== null && change > 0 ? '#167049' : change !== null && change < 0 ? '#b43c36' : muted;

function wordmark(size: number, markSize: number) {
  return h(
    'div',
    { style: { display: 'flex', alignItems: 'center', gap: size * 0.25 } },
    h('img', {
      src: `data:image/svg+xml;base64,${Buffer.from(markSvg).toString('base64')}`,
      width: markSize,
      height: markSize,
    }),
    h(
      'div',
      { style: { display: 'flex', gap: size * 0.22, fontSize: size, letterSpacing: -size * 0.05 } },
      h('span', { style: { fontWeight: 800 } }, 'Vibe'),
      h('span', { style: { fontWeight: 500 } }, 'IDX'),
    ),
  );
}

function sparkline(closes: number[]) {
  const first = closes[0],
    last = closes.at(-1);
  if (first === undefined || last === undefined) return null;
  const low = Math.min(...closes),
    high = Math.max(...closes);
  const points = closes.map((close, i) => [
    closes.length === 1 ? 536 : (i / (closes.length - 1)) * 1072,
    high === low ? 65 : 120 - ((close - low) / (high - low)) * 110,
  ]);
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const stroke = color(last - first);
  return h(
    'svg',
    { width: 1072, height: 146, viewBox: '0 0 1072 146' },
    h(
      'defs',
      null,
      h(
        'linearGradient',
        { id: 'area', x1: '0', y1: '0', x2: '0', y2: '1' },
        h('stop', { offset: '0%', stopColor: stroke, stopOpacity: 0.14 }),
        h('stop', { offset: '100%', stopColor: stroke, stopOpacity: 0 }),
      ),
    ),
    h('path', {
      d: `${path} L${points.at(-1)?.[0]},146 L${points[0]?.[0]},146 Z`,
      fill: 'url(#area)',
    }),
    h('path', {
      d: path,
      fill: 'none',
      stroke,
      strokeWidth: 4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
    closes.length === 1 ? h('circle', { cx: 536, cy: 65, r: 5, fill: stroke }) : null,
  );
}

function cardTree(card: TickerCard | null) {
  const root = {
    display: 'flex',
    position: 'relative',
    width: 1200,
    height: 630,
    background: paper,
    color: ink,
    fontFamily: 'Manrope',
    fontWeight: 500,
  } satisfies CSSProperties;
  if (!card)
    return h(
      'div',
      {
        style: { ...root, flexDirection: 'column', justifyContent: 'center', gap: 52, padding: 64 },
      },
      wordmark(150, 132),
      h(
        'div',
        { style: { fontSize: 34, color: muted } },
        'Indonesian stock prices, ownership and broker flow',
      ),
    );
  const price = `IDR ${nf(card.close)}`;
  return h(
    'div',
    { style: root },
    h(
      'div',
      { style: { display: 'flex', position: 'absolute', left: 64, top: 48 } },
      wordmark(32, 44),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          position: 'absolute',
          left: 64,
          top: 142,
          flexDirection: 'column',
          width: 584,
        },
      },
      h(
        'div',
        {
          style: {
            fontSize: Math.min(150, 900 / card.ticker.length),
            fontWeight: 800,
            letterSpacing: -7,
            lineHeight: 1.15,
          },
        },
        card.ticker,
      ),
      h(
        'div',
        {
          style: {
            width: 584,
            fontSize: 30,
            color: muted,
            marginTop: 12,
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
      {
        style: {
          display: 'flex',
          position: 'absolute',
          right: 64,
          top: 160,
          flexDirection: 'column',
          alignItems: 'flex-end',
          width: 448,
          gap: 12,
        },
      },
      h(
        'div',
        {
          style: {
            fontSize: price.length > 11 ? 56 : 72,
            fontWeight: 800,
            letterSpacing: -3,
            whiteSpace: 'nowrap',
          },
        },
        price,
      ),
      h(
        'div',
        { style: { fontSize: 36, color: color(card.changePct) } },
        card.changePct === null ? '—' : `${signed(card.changePct, (v) => nf(v, 2))}%`,
      ),
      h('div', { style: { fontSize: 26, color: muted } }, dateText(card.date)),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          position: 'absolute',
          left: 64,
          bottom: 48,
          width: 1072,
          height: 146,
        },
      },
      sparkline(card.closes),
    ),
  );
}

export async function renderCard(card: TickerCard | null, fontLoader = loadFonts) {
  const svg = await satori(cardTree(card), { width: 1200, height: 630, fonts: await fontLoader() });
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
