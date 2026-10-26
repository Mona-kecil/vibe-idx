// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { App } from './App';
import type { Feed, Ticker } from './data';

const auth = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  getAccessToken: vi.fn<() => Promise<string | undefined>>(async () => 'test-token'),
  signIn: vi.fn<() => Promise<void>>(async () => {}),
  signOut: vi.fn<() => void>(),
}));
vi.mock('@workos-inc/authkit-react', () => ({
  useAuth: () => ({ ...auth, isLoading: false }),
  LoginRequiredError: class extends Error {},
}));
const dates = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'];
const row = (broker: string, shares: number) => ({
  broker,
  investor_type: 'LOCAL',
  shares,
  value: shares * 100,
  avg_price: 100,
  freq: 1,
});
const days = dates.map((date) => ({
  date,
  buy: [row('AK', 500), row('SQ', 200)],
  sell: [row('PD', 400), row('CC', 300)],
}));
function ticker(symbol: string): Ticker {
  return {
    ticker: symbol,
    name: `Company ${symbol}`,
    prices: dates.map((date, i) => ({
      date,
      close: 100 + i,
      volume: 700,
      value: 70000,
      net_foreign: 0,
    })),
    holders: [{ investor: 'Synthetic holder', shares: 100, pct: 10 }],
    changes: [],
    one_pct: { date: '2026-09-30', holders: [] },
    insiders: [],
    disclosures: [],
    registry_history: [],
  };
}
const symbols = [
  'AAAA',
  'BBBB',
  'CCCC',
  'DDDD',
  'EEEE',
  'FFFF',
  'GGGG',
  'HHHH',
  'IIII',
  'JJJJ',
  'KKKK',
  'LLLL',
  'BBCA',
  'MMMM',
];
const ownership = (
  ticker: string,
  investor: string,
  before: number,
  after: number | null,
  extra = {},
): Feed[number] => ({
  ticker,
  date: '2026-10-22',
  kind: 'five_pct_change',
  numbers: {
    investor,
    shares_before: 10000,
    shares_after: after === null ? null : 20000,
    net_shares: after === null ? null : 10000,
    pct_before: before,
    pct_after: after,
    previous_date: '2026-10-21',
    ...extra,
  },
});
const ara = (ticker: string, change_pct: number): Feed[number] => ({
  ticker,
  date: '2026-10-22',
  kind: 'ara',
  numbers: { change_pct, close: 135, prev: 100, band_pct: 34 },
});
const volume = (ticker: string, multiple: number): Feed[number] => ({
  ticker,
  date: '2026-10-22',
  kind: 'volume_spike',
  numbers: { multiple, volume: 500, avg_volume: 100, prior_days: 20, value: 50000 },
});
let feed: unknown[];
let history: Ticker;
let root: Root, host: HTMLDivElement;
const fetcher = vi.fn<(input: string) => Promise<Response>>(async (input) => {
  const url = String(input);
  if (url.includes('/api/brokers'))
    return Response.json({
      ticker: new URL(url, 'http://localhost').searchParams.get('ticker'),
      days,
    });
  if (url.includes('health.json'))
    return Response.json({
      prices: dates.at(-1),
      indices: dates.at(-1),
      five_pct: dates.at(-1),
      one_pct: '2026-09-30',
      issuers: dates.at(-1),
      run_at: dates.at(-1),
    });
  if (url.includes('tickers.json'))
    return Response.json(
      symbols.map((symbol) => ({
        ticker: symbol,
        name: `Company ${symbol}`,
        close: 100,
        change_pct: 1,
        volume: 700,
        value: 70000,
        net_foreign: 0,
      })),
    );
  if (url.includes('market.json'))
    return Response.json({
      date: dates.at(-1),
      up: 1,
      down: 1,
      history: dates.map((date) => ({ date, close: 5000, change: 10, change_pct: 1 })),
    });
  if (url.includes('feed.json')) return Response.json(feed);
  if (url.includes('/api/news')) return Response.json([]);
  return Response.json(history);
});
function element<T extends Element>(selector: string, type: { new (...args: never[]): T }): T {
  const el = host.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`Missing ${selector}`);
  return el;
}
async function click(selector: string) {
  await act(async () => element(selector, HTMLButtonElement).click());
}
async function render() {
  await act(async () => root.render(<App initialUrl={window.location.pathname} />));
}
const stockOrder = (selector: string) =>
  [...host.querySelectorAll(selector)].map((el) => el.textContent);
async function typeQuery(query: string) {
  await act(async () => {
    const input = element('input[type="search"]', HTMLInputElement);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  auth.user = null;
  auth.getAccessToken.mockClear();
  auth.getAccessToken.mockResolvedValue('test-token');
  fetcher.mockClear();
  history = ticker('BBCA');
  feed = [];
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('daily briefing', () => {
  it('keeps latest ownership alphabetic, merges holder aliases, ranks stock and holder moves, and renders exits without invented shares', async () => {
    feed = [
      ownership('BBBB', 'Exit holder', 15, null, { exited: true, net_shares: 123 }),
      ownership('AAAA', 'Zeta', 6, 8),
      ownership('AAAA', 'PT Alpha Tbk.', 6, 6.5),
      ownership('AAAA', 'Alpha', 6, 6.5),
      ...symbols
        .slice(2, 12)
        .map((t) => ownership(t, 'Holder', t === 'CCCC' ? 5.1 : 5, t === 'CCCC' ? null : 6)),
      { ...ownership('BBCA', 'Old filing', 5, 99), date: '2026-10-21' },
      ownership('UNKNOWN', 'Missing stock', 5, 6),
    ];
    await render();
    expect(stockOrder('#ownership-rows .stock-id strong')).toEqual(symbols.slice(0, 10));
    expect(stockOrder('#ownership-rows .holder').slice(0, 3)).toEqual([
      'PT Alpha Tbk.',
      'Zeta',
      'Exit holder',
    ]);
    expect(host.textContent).not.toContain('Old filing');
    expect(host.textContent).not.toContain('Missing stock');
    const exit = [...host.querySelectorAll('.holder-row')].find((el) =>
      el.textContent?.includes('Exit holder'),
    );
    expect(exit?.textContent).toContain('15.00 → <5%');
    expect(exit?.querySelector('.net')?.textContent).toBe('Exit');
    expect(host.querySelectorAll('.net.exit')).toHaveLength(2);
    expect(host.querySelector('.sources')?.textContent).toContain('1 feed record excluded');
    await click('[aria-controls="ownership-rows"]');
    expect(host.querySelectorAll('#ownership-rows > div')).toHaveLength(12);
    await click('[aria-controls="ownership-rows"]');
    expect(host.querySelectorAll('#ownership-rows > div')).toHaveLength(10);
    await act(async () => {
      const select = element('select[aria-label="Sort ownership moves"]', HTMLSelectElement);
      select.value = 'move';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(stockOrder('#ownership-rows .stock-id strong').slice(0, 2)).toEqual(['BBBB', 'AAAA']);
    expect(stockOrder('#ownership-rows .holder').slice(0, 3)).toEqual([
      'Exit holder',
      'Zeta',
      'PT Alpha Tbk.',
    ]);
    expect(window.localStorage.getItem('vibe-idx:ownership-sort')).toBe('move');
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(stockOrder('#ownership-rows .stock-id strong')[0]).toBe('BBBB');
  });
  it('groups multiple signals first, sorts each kind by strength, ignores new kinds, and lists each stock once', async () => {
    feed = [
      ara('AAAA', 40),
      volume('AAAA', 12),
      ...['BBBB', 'CCCC', 'DDDD', 'EEEE', 'FFFF', 'GGGG'].map((t, i) => ara(t, 35 + i)),
      volume('HHHH', 7),
      volume('IIII', 9),
      {
        ticker: 'JJJJ',
        date: dates[3],
        kind: 'foreign_streak',
        numbers: { streak_days: 7, net_foreign: 1e8 },
      },
      {
        ticker: 'KKKK',
        date: dates[3],
        kind: 'foreign_streak',
        numbers: { streak_days: 7, net_foreign: 2e8 },
      },
      {
        ticker: 'LLLL',
        date: dates[3],
        kind: 'green_on_red',
        numbers: { change_pct: 5, market_change_pct: -3, value: 1e9 },
      },
      {
        ticker: 'BBCA',
        date: dates[3],
        kind: 'foreign_streak',
        numbers: { streak_days: 8, net_foreign: 1e7 },
      },
      {
        ticker: 'MMMM',
        date: dates[3],
        kind: 'green_on_red',
        numbers: { change_pct: 2, market_change_pct: -3, value: 1e9 },
      },
      { kind: 'future_signal', ticker: 'BBCA', numbers: {} },
    ];
    await render();
    expect(stockOrder('.signal-list h3')).toEqual([
      'Multiple signals',
      'ARA',
      'Volume spike',
      'Foreign streak',
      'Green on red',
    ]);
    expect(stockOrder('#signals-multiple-rows strong')).toEqual(['AAAA']);
    expect(stockOrder('#signals-ara-rows strong')).toEqual([
      'GGGG',
      'FFFF',
      'EEEE',
      'DDDD',
      'CCCC',
    ]);
    await click('[aria-controls="signals-ara-rows"]');
    expect(stockOrder('#signals-ara-rows strong')).toEqual([
      'GGGG',
      'FFFF',
      'EEEE',
      'DDDD',
      'CCCC',
      'BBBB',
    ]);
    const listed = stockOrder('.signal-group .stock-id strong');
    expect(listed).toHaveLength(14);
    expect(new Set(listed).size).toBe(14);
    expect(stockOrder('#signals-volume_spike-rows strong')).toEqual(['IIII', 'HHHH']);
    expect(stockOrder('#signals-foreign_streak-rows strong')).toEqual(['BBCA', 'KKKK', 'JJJJ']);
    expect(stockOrder('#signals-green_on_red-rows strong')).toEqual(['LLLL', 'MMMM']);
    expect(host.querySelector('#signals-volume_spike-rows .signal-item .up')).toBeNull();
    expect(
      host.querySelector('#signals-ara-rows .signal-link')?.textContent?.match(/%/g),
    ).toHaveLength(1);
  });
  it('searches company names and codes, supports the slash shortcut, and opens the selected research page', async () => {
    const navigate = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    await render();
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true })),
    );
    expect(document.activeElement).toBe(host.querySelector('input[type="search"]'));
    await typeQuery('Company BBCA');
    expect(host.querySelector('.search-results a')?.getAttribute('href')).toBe('/t/BBCA');
    await click('.search-results [aria-label="Pin BBCA"]');
    expect(host.querySelector('.watch-link')?.getAttribute('href')).toBe('/t/BBCA');
    await click('.search-results [aria-label="Unpin BBCA"]');
    expect(host.querySelector('.watch-link')).toBeNull();
    await typeQuery('bbca');
    await act(async () =>
      element('input[type="search"]', HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      ),
    );
    expect(navigate).toHaveBeenCalledWith('/t/BBCA');
    expect(auth.getAccessToken).not.toHaveBeenCalled();
  });
  it('seeds saved workspace tickers once, fetches watch prices and the latest disclosure, and persists unpinning', async () => {
    window.localStorage.setItem(
      'vibe-idx-workspace-v1',
      JSON.stringify({ panels: [{ state: { ticker: 'BBCA' } }, { state: { ticker: 'BBCA' } }] }),
    );
    feed = [ara('BBCA', 35)];
    history.disclosures = [
      {
        id: 'new',
        title: 'Newer disclosure',
        published_at: '2026-10-23T12:00:00',
        url: 'https://idx.id/report',
        kind: 'other',
        attachments: [],
      },
    ];
    await render();
    expect(host.querySelectorAll('.watch-group')).toHaveLength(1);
    expect(host.querySelector('.watch-link .signal-price')?.textContent).toBe('103');
    expect(host.querySelector('.watch-link .latest-event')?.textContent).toContain(
      'Newer disclosure',
    );
    expect(host.querySelector('.watch-link svg')).not.toBeNull();
    await click('.watch-group [aria-label="Unpin BBCA"]');
    expect(host.querySelectorAll('.watch-group')).toHaveLength(0);
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(host.querySelectorAll('.watch-group')).toHaveLength(0);
    await click('.signal-group [aria-label="Pin BBCA"]');
    expect(host.querySelectorAll('.watch-group')).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem('vibe-idx:watchlist') ?? 'null')).toEqual([
      'BBCA',
    ]);
  });
  it('keeps the briefing, sort and pins working when sandbox storage throws', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    feed = [ownership('AAAA', 'Holder', 5, 6)];
    await render();
    expect(host.querySelector('h1')?.textContent).toBe('IHSG');
    await click('[aria-label="Pin AAAA"]');
    expect(host.querySelector('.watch-group')).not.toBeNull();
    await act(async () => {
      const select = element('select', HTMLSelectElement);
      select.value = 'move';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('ticker research regressions', () => {
  it('opens public ticker research without broker tokens and returns to the briefing', async () => {
    window.history.replaceState(null, '', '/t/BBCA');
    await render();
    expect(host.querySelector('h1')?.textContent).toBe('BBCA');
    expect(host.textContent).toContain('Company BBCA');
    expect(host.querySelectorAll('.module-panel')).toHaveLength(0);
    expect(host.querySelector('#broker-section button')?.textContent).toBe('Sign in');
    expect(auth.getAccessToken).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/api/brokers'))).toBe(false);
    expect(window.localStorage.getItem('vibe-idx:watchlist')).toBeNull();
    await act(async () => {
      window.history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(host.querySelector('h1')?.textContent).toBe('IHSG');
    await act(async () => {
      window.history.pushState(null, '', '/callback');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Signing you in…');
    await act(async () => {
      window.history.pushState(null, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(auth.signIn).toHaveBeenCalled();
    auth.signIn.mockClear();
  });
  it('loads signed-in ticker brokers through the bearer API and tolerates unavailable news', async () => {
    auth.user = { id: 'fixture-user', email: 'fixture@example.test' };
    window.history.replaceState(null, '', '/t/BBCA');
    const baseFetch = fetcher.getMockImplementation();
    fetcher.mockImplementation(async (input) =>
      String(input).includes('/api/news')
        ? new Response('', { status: 400 })
        : baseFetch
          ? baseFetch(input)
          : Response.json([]),
    );
    await render();
    expect(auth.getAccessToken).toHaveBeenCalled();
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes('/api/brokers?ticker=BBCA')),
    ).toBe(true);
    const rows = host.querySelectorAll('#broker-section tbody tr');
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain('AK');
    expect(rows[0]?.textContent).toContain('+200.0K');
    expect(host.querySelector('#news')?.textContent).not.toContain('No news');
    await act(() => new Promise((resolve) => setTimeout(resolve, 350)));
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/api/news?ticker=BBCA'))).toBe(
      true,
    );
    expect(host.querySelector('#news')?.textContent).toContain('No news');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    fetcher.mockImplementation(baseFetch ?? (async () => Response.json([])));
  });
});
