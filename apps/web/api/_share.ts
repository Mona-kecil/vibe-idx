import { z } from 'zod';
import { dateText, nf, signed } from '../src/ticker/format.js';

export type TickerCard = {
  ticker: string;
  name: string;
  date: string;
  close: number;
  changePct: number | null;
  closes: number[];
};

const cardSchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9-]{1,12}$/),
  name: z.string(),
  prices: z.array(z.object({ date: z.iso.date(), close: z.number().nonnegative() })),
});

export function parseTickerCard(json: unknown): TickerCard | null {
  const parsed = cardSchema.safeParse(json);
  if (!parsed.success) return null;
  const { ticker, name, prices } = parsed.data;
  const last = prices.at(-1);
  if (!last) return null;
  const previous = prices.at(-2);
  return {
    ticker,
    name: name
      .replace(/^PT\.?\s+/i, '')
      .replace(/\(Persero\)/gi, '')
      .replace(/\bTbk\.?\s*$/i, '')
      .replace(/\.\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim(),
    date: last.date,
    close: last.close,
    changePct: previous?.close ? ((last.close - previous.close) / previous.close) * 100 : null,
    closes: prices.slice(-60).map((price) => price.close),
  };
}

export type ShareMeta = { title: string; description: string; url: string; image: string };

export function tickerMeta(card: TickerCard, origin: string): ShareMeta {
  return {
    title: `${card.ticker} ${card.name}`,
    description: `IDR ${nf(card.close)}${card.changePct === null ? '' : ` ${signed(card.changePct, (v) => nf(v, 2))}%`} on ${dateText(card.date)}`,
    url: `${origin}/t/${card.ticker}`,
    image: `${origin}/api/og?ticker=${card.ticker}&d=${card.date}`,
  };
}

export function defaultMeta(origin: string): ShareMeta {
  return {
    title: 'Vibe IDX',
    description: 'Indonesian stock prices, ownership and broker flow.',
    url: `${origin}/`,
    image: `${origin}/api/og`,
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function withShareMeta(html: string, meta: ShareMeta): string {
  const { title, description, url, image } = meta;
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    ...[
      ['name', 'description', description],
      ['property', 'og:title', title],
      ['property', 'og:description', description],
      ['property', 'og:url', url],
      ['property', 'og:image', image],
      ['property', 'og:image:width', '1200'],
      ['property', 'og:image:height', '630'],
      ['property', 'og:site_name', 'Vibe IDX'],
      ['property', 'og:type', 'website'],
      ['name', 'twitter:card', 'summary_large_image'],
      ['name', 'twitter:title', title],
      ['name', 'twitter:description', description],
      ['name', 'twitter:image', image],
    ].map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value ?? '')}" />`),
  ];
  if (!html.includes('<!-- share -->') || !html.includes('<!-- /share -->'))
    throw new Error('Share metadata block missing');
  return html.replace(/<!-- share -->[\s\S]*?<!-- \/share -->/, () =>
    ['<!-- share -->', ...tags, '<!-- /share -->'].join('\n'),
  );
}
