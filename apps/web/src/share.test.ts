import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vite-plus/test';
import { defaultMeta, parseTickerCard, tickerMeta, withShareMeta } from '../api/_share';
import history from './ticker/fixtures/TPIA-history.json';
import { tickerSchema } from './data';
import { visiblePrices } from './ticker/logic';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('share metadata', () => {
  it('draws the same three-month window the ticker page opens on', () => {
    const card = parseTickerCard(history);
    const page = visiblePrices(tickerSchema.parse(history).prices, '3M');
    expect(card).not.toBeNull();
    expect(card?.closes).toEqual(page.map((p) => p.close));
    expect(card?.start).toBe(page[0]?.date);
    expect(card?.date).toBe(history.prices.at(-1)?.date);
    const daily = Array.from({ length: 200 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
      close: 100 + i,
    }));
    const windowed = parseTickerCard({ ticker: 'BBCA', name: 'Bank', prices: daily });
    expect(windowed?.start).toBe('2026-04-19');
    expect(windowed?.closes.at(-1)).toBe(299);
  });

  it('cleans company suffixes and formats the price, daily change and date', () => {
    const card = parseTickerCard({
      ticker: 'BBCA',
      name: 'PT Bank Central Asia (Persero) Tbk.',
      prices: [
        { date: '2026-11-09', close: 5325 },
        { date: '2026-11-10', close: 5300 },
      ],
    });
    expect(card).toMatchObject({ name: 'Bank Central Asia', close: 5300 });
    if (!card) throw new Error('Expected a ticker card');
    expect(tickerMeta(card, 'https://idx.test')).toEqual({
      title: 'BBCA Bank Central Asia',
      description: 'IDR 5,300 −0.47% on 10 Nov 2026',
      url: 'https://idx.test/t/BBCA',
      image: 'https://idx.test/api/og?ticker=BBCA&d=2026-11-10',
    });
  });

  it('handles missing prices and unavailable daily changes', () => {
    expect(parseTickerCard({ ticker: 'BBCA', name: 'Bank', prices: [] })).toBeNull();
    expect(
      parseTickerCard({ ticker: 'BBCA', name: 'Bank', prices: [{ date: 'bad', close: 1 }] }),
    ).toBeNull();
    const card = parseTickerCard({
      ticker: 'BBCA',
      name: 'Bank',
      prices: [{ date: '2026-11-10', close: 5300 }],
    });
    expect(card?.changePct).toBeNull();
    if (!card) throw new Error('Expected a ticker card');
    expect(tickerMeta(card, 'https://idx.test').description).toBe('IDR 5,300 on 10 Nov 2026');
    expect(
      parseTickerCard({
        ticker: 'BBCA',
        name: 'Bank',
        prices: [
          { date: '2026-11-09', close: 0 },
          { date: '2026-11-10', close: 5300 },
        ],
      })?.changePct,
    ).toBeNull();
  });

  it('replaces the default block and escapes names and every metadata value', () => {
    const meta = {
      title: 'TEST A & "B" <C> \'D\' $&',
      description: 'A & "B"',
      url: 'https://idx.test/?a=1&b="2"',
      image: 'https://idx.test/api/og?ticker=TEST&d="date"',
    };
    const result = withShareMeta(html, meta);
    expect(result).toContain(
      '<title>TEST A &amp; &quot;B&quot; &lt;C&gt; &#39;D&#39; $&amp;</title>',
    );
    expect(result).toContain('content="A &amp; &quot;B&quot;"');
    expect(result).toContain('https://idx.test/?a=1&amp;b=&quot;2&quot;');
    expect(result).toContain('https://idx.test/api/og?ticker=TEST&amp;d=&quot;date&quot;');
    expect(result.match(/<title>/g)).toHaveLength(1);
    expect(result.match(/property="og:title"/g)).toHaveLength(1);
    expect(result).not.toContain('https://idx.monosodiums.com/api/og');
    expect(result).toContain('<div id="root"></div>');
    expect(withShareMeta(result, defaultMeta('https://idx.test'))).toContain(
      '<title>Vibe IDX</title>',
    );
  });

  it('ships the same default metadata in static HTML', () => {
    expect(
      withShareMeta(html, defaultMeta('https://idx.monosodiums.com')).replace(/\s+/g, ' '),
    ).toBe(html.replace(/\s+/g, ' '));
  });
});
