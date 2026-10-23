import { describe, expect, it, vi } from 'vite-plus/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { App, rowIndexFromKeyboard } from './App';
import type { Feed, Health, Market, Ticker } from './data';

vi.mock('@workos-inc/authkit-react', () => ({
  useAuth: () => ({ user: null, isLoading: false, signIn: async () => {}, signOut: () => {} }),
  LoginRequiredError: class extends Error {},
}));

const health: Health = {
  prices: '2026-10-22',
  indices: '2026-10-22',
  five_pct: '2026-10-21',
  one_pct: '2026-09-30',
  issuers: '2026-10-22',
  run_at: '2026-10-22 15:00:00+00',
};
const market: Market = {
  date: '2026-10-22',
  up: 100,
  down: 200,
  history: [{ date: '2026-10-22', close: 5000, change: -150, change_pct: -3 }],
};
const feed: Feed = [
  {
    kind: 'volume_spike',
    ticker: 'VOL',
    date: '2026-10-22',
    numbers: {
      volume: 60000000,
      avg_volume: 10000000,
      multiple: 6,
      value: 6000000000,
      prior_days: 20,
    },
  },
  {
    kind: 'ara',
    ticker: 'ARA',
    date: '2026-10-22',
    numbers: { prev: 100, close: 135, change_pct: 35, band_pct: 34 },
  },
  {
    kind: 'foreign_streak',
    ticker: 'BUY',
    date: '2026-10-22',
    numbers: { streak_days: 7, net_foreign: 123456789 },
  },
  {
    kind: 'green_on_red',
    ticker: 'GREEN',
    date: '2026-10-22',
    numbers: { change_pct: 2, market_change_pct: -3, value: 2000000000 },
  },
  {
    kind: 'five_pct_change',
    ticker: 'EXIT',
    date: '2026-10-21',
    numbers: {
      investor: 'Departing investor',
      previous_date: '2026-10-20',
      shares_before: 6000,
      shares_after: null,
      net_shares: null,
      pct_before: 6,
      pct_after: null,
    },
  },
  {
    kind: 'five_pct_change',
    ticker: 'ENTRY',
    date: '2026-10-21',
    numbers: {
      investor: 'New investor',
      previous_date: '2026-10-20',
      shares_before: 0,
      shares_after: 7000,
      net_shares: 7000,
      pct_before: 0,
      pct_after: 7,
    },
  },
];
const ticker: Ticker = {
  ticker: 'BBCA',
  name: 'PT Bank Central Asia Tbk.',
  prices: [
    { date: '2026-10-21', close: 5000, volume: 100, value: 500000, net_foreign: 10000 },
    { date: '2026-10-22', close: 5500, volume: 200, value: 1100000, net_foreign: -20000 },
  ],
  holders: [{ investor: 'Current investor', shares: 8000, pct: 8 }],
  changes: [
    {
      date: '2026-10-21',
      investor: 'Current investor',
      shares_before: 7000,
      shares_after: 8000,
      net_shares: 1000,
      pct_before: 7,
      pct_after: 8,
    },
  ],
  one_pct: {
    date: '2026-09-30',
    holders: [
      {
        investor: 'Monthly investor',
        shares: 1500,
        pct: 1.5,
        classification: 'Corporate',
        local_foreign: 'Lokal',
      },
    ],
  },
  disclosures: [
    {
      id: 'report-1',
      title: 'Official disclosure',
      published_at: '2026-10-21',
      url: 'https://www.idx.id/disclosure.pdf',
      kind: 'registry',
      attachments: [],
    },
  ],
  insiders: [
    {
      date: '2026-10-20',
      reporter: 'Reporting director',
      shares_before: 100,
      shares_after: 200,
      net_shares: 100,
      url: 'https://www.idx.id/insider.pdf',
    },
  ],
  registry: {
    date: '2026-09-30',
    free_float_pct: 42.46,
    total_shares: 10000,
    sid_count: null,
    url: 'https://www.idx.id/registry.pdf',
  },
};

describe('IDX anomaly radar', () => {
  it('keeps public ticker evidence and a passwordless broker gate without English chart labels in Indonesian', () => {
    const english = renderToStaticMarkup(
      <App initialUrl="/t/BBCA" initialData={{ health, ticker }} initialLocale="en" />,
    );
    const indonesian = renderToStaticMarkup(
      <App initialUrl="/t/BBCA" initialData={{ health, ticker }} initialLocale="id" />,
    );
    expect(english).toContain('Sign in to view broker summary');
    expect(indonesian).toContain('Masuk untuk melihat ringkasan broker');
    expect(indonesian).toContain('Gunakan kode sekali pakai');
    expect(indonesian).toContain('Pemegang saham 5% terakhir');
    expect(indonesian).toContain('5.500');
    expect(english).toContain('aria-label="BBCA closing price history"');
    expect(english).toContain('<title>BBCA closing price history</title>');
    expect(indonesian).toContain('aria-label="BBCA riwayat harga penutupan"');
    expect(indonesian).toContain('<title>BBCA riwayat harga penutupan</title>');
    for (const markup of [english, indonesian]) {
      expect(markup).toContain('PT Bank Central Asia Tbk.');
      expect(markup).toContain('Current investor');
      expect(markup).toContain('2026-10-22');
      expect(markup).toContain('Monthly investor');
      expect(markup).toContain('Reporting director');
      expect(markup).toContain('Official disclosure');
      expect(markup).not.toContain('fixture-access-key');
    }
  });
  it('renders localized signals without English decimals or zero holdings for 5% exits', () => {
    const markup = renderToStaticMarkup(
      <App initialUrl="/" initialData={{ health, radar: { market, feed } }} />,
    );
    for (const title of [
      'Volume spikes',
      'ARA moves',
      'Foreign buying streaks',
      'Green on red',
      '5% ownership changes',
    ]) {
      expect(markup).toContain(title);
    }
    expect(markup.match(/href="\/t\/[^"]+"/g)).toHaveLength(feed.length);
    for (const item of feed) expect(markup).toContain(`href="/t/${item.ticker}"`);
    for (const evidence of [
      '60,000,000',
      '6.00×',
      '135',
      '35.00%',
      '7 trading days',
      '123,456,789',
      '2.00%',
      '-3.00%',
    ]) {
      expect(markup).toContain(evidence);
    }
    const start = markup.indexOf('href="/t/EXIT"');
    const exit = markup.slice(start, markup.indexOf('</li>', start));
    expect(exit).toContain('Departing investor');
    expect(exit).toContain('6.00% → below 5%');
    expect(exit).toContain('Exit');
    expect(exit).toContain('Net shares: -');
    expect(exit).not.toContain('0.00%');
    expect(exit).not.toContain('Change');
    expect(markup).toContain('Entry · Net shares: 7,000');
    expect(markup).toContain('2026-10-21');
    expect(markup).toContain('Since 2026-10-20');
    const indonesian = renderToStaticMarkup(
      <App initialUrl="/" initialData={{ health, radar: { market, feed } }} initialLocale="id" />,
    );
    expect(markup).toContain('aria-label="IHSG close history"');
    expect(markup).toContain('<title>IHSG close history</title>');
    expect(indonesian).toContain('6,00×');
    expect(indonesian).not.toContain('6.00×');
    expect(indonesian).toContain('aria-label="Riwayat penutupan IHSG"');
    expect(indonesian).toContain('<title>Riwayat penutupan IHSG</title>');
  });

  it('routes BBCA to its history and ownership and rejects missing tickers and removed paths', () => {
    const markup = renderToStaticMarkup(
      <App initialUrl="/t/BBCA" initialData={{ health, ticker }} />,
    );
    for (const text of [
      'PT Bank Central Asia Tbk.',
      '5,500',
      '10.00%',
      'BBCA closing price history',
      'Recent trading days',
      'Current 5% holders',
      'Current investor',
      '8.00%',
      'Net shares: 1,000',
      'Last 90 days',
      'Prices: 2026-10-22',
      'Ownership as of 2026-10-21',
    ]) {
      expect(markup).toContain(text);
    }
    expect(markup).not.toContain('Page not found');
    for (const path of ['/t/NOPE', '/insiders']) {
      const missing = renderToStaticMarkup(
        <App initialUrl={path} initialData={{ health, ticker: null }} />,
      );
      expect(missing).toContain('Page not found');
      expect(missing).not.toContain('Recent trading days');
    }
  });

  it('maps up and down arrow hotkeys to bounded row highlight changes', () => {
    expect(rowIndexFromKeyboard({ key: 'ArrowDown', targetTagName: 'BODY' }, null, 3)).toBe(0);
    expect(rowIndexFromKeyboard({ key: 'ArrowDown', targetTagName: 'BODY' }, 0, 3)).toBe(1);
    expect(rowIndexFromKeyboard({ key: 'ArrowDown', targetTagName: 'BODY' }, 2, 3)).toBe(2);
    expect(rowIndexFromKeyboard({ key: 'ArrowUp', targetTagName: 'BODY' }, null, 3)).toBe(2);
    expect(rowIndexFromKeyboard({ key: 'ArrowUp', targetTagName: 'BODY' }, 2, 3)).toBe(1);
    expect(rowIndexFromKeyboard({ key: 'ArrowUp', targetTagName: 'BODY' }, 0, 3)).toBe(0);
    expect(rowIndexFromKeyboard({ key: 'ArrowDown', targetTagName: 'INPUT' }, null, 3)).toBeNull();
    expect(
      rowIndexFromKeyboard(
        { key: 'ArrowDown', targetIsContentEditable: true, targetTagName: 'DIV' },
        null,
        3,
      ),
    ).toBeNull();
    expect(rowIndexFromKeyboard({ key: 'ArrowDown', targetTagName: 'BODY' }, null, 0)).toBeNull();
    expect(rowIndexFromKeyboard({ key: 'x', targetTagName: 'BODY' }, null, 3)).toBeNull();
  });
});
