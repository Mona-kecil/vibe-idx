// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { App } from './App';
import { tickerSchema, type Feed, type Ticker } from './data';
import tpiaFixture from './ticker/fixtures/TPIA-history.json';

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
    one_pct_history: [],
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
const marketStock = (ticker: string, value: number, change: number | null) => ({
  ticker,
  name: `Company ${ticker}`,
  close: 100,
  windows: {
    '1d': { change_pct: change, value, rel_volume: 1.5 },
    '3d': { change_pct: change === null ? null : -change, value: value * 3, rel_volume: 2.5 },
    '5d': { change_pct: change === null ? null : change * 2, value: value * 5, rel_volume: 3.5 },
  },
});
const summary = {
  date: '2026-10-23',
  stocks: [
    marketStock('AAAA', 1e9, 2),
    marketStock('BBCA', 2e9, -1),
    marketStock('CCCC', 3e9, null),
  ],
};
const marketAccumulation = {
  date: summary.date,
  stocks: summary.stocks.map((s, i) => ({
    ticker: s.ticker,
    windows: {
      '1d': i === 2 ? null : { pct: 0.1 + i * 0.1, broker: 'YP' },
      '3d': i === 2 ? null : { pct: 0.3 + i * 0.1, broker: 'AA' },
      '5d': i === 2 ? null : { pct: 0.5 + i * 0.1, broker: 'BB' },
    },
  })),
};
const fetcher = vi.fn<(input: string) => Promise<Response>>(async (input) => {
  const url = String(input);
  if (url.includes('market-summary.json')) return Response.json(summary);
  if (url.includes('/api/brokers?view=market')) return Response.json(marketAccumulation);
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
  it('seeds saved workspace tickers once, shows snapshot prices and the latest disclosure, and persists unpinning', async () => {
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
    expect(host.querySelector('.watch-link .signal-price')?.textContent).toBe('100');
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
  it('clusters overlapping TPIA reports on the drawn line without changing anchored values or extending HSBC', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(948);
    history = tickerSchema.parse(tpiaFixture);
    window.history.replaceState(null, '', '/t/TPIA');
    await render();
    const keys = [...host.querySelectorAll('.holder-key')];
    const barito = keys.find((el) => el.textContent?.includes('BARITO PACIFIC'));
    expect(barito?.querySelector('strong')?.getAttribute('title')).toBe('29,957,670,400 shares');
    expect(barito?.querySelector('small')?.textContent).toBe('34.63%');
    expect(
      [...host.querySelectorAll('.composition-item')]
        .find((el) => el.textContent?.includes('BARITO PACIFIC'))
        ?.querySelector('strong')?.textContent,
    ).toBe('34.63%');
    const scg = keys.find((el) => el.textContent?.includes('SCG CHEMICALS'));
    const scgLine = host.querySelector(
      `.holdings-series[data-holder="${scg?.getAttribute('data-holder')}"]`,
    );
    // Seven reports become three markers: Jan 13, Feb 24, and the five June 2–8 reports.
    expect(scgLine?.querySelectorAll('.holding-event')).toHaveLength(3);
    const marker = scgLine?.querySelector('[data-date="2026-06-08"]');
    if (!marker) throw new Error('Missing SCG June cluster');
    expect(marker.getAttribute('aria-label')).toBe(
      'SCG CHEMICALS PUBLIC COMPANY LIMITED 2 Jun 2026–8 Jun 2026, 5 reports',
    );
    for (const unit of ['shares', 'pct']) {
      await click(`.holdings-mode [data-unit="${unit}"]`);
      const diagonal = scgLine
        ?.querySelector('.holding-uncertain')
        ?.getAttribute('d')
        ?.match(/^M([^,]+),(\S+) L([^,]+),(\S+)$/);
      if (!diagonal) throw new Error('Missing SCG May 29–June 30 diagonal');
      const may29X = Number(diagonal[1]),
        may29Y = Number(diagonal[2]),
        june30X = Number(diagonal[3]),
        june30Y = Number(diagonal[4]),
        cx = Number(marker.getAttribute('cx')),
        cy = Number(marker.getAttribute('cy'));
      expect(cx).toBeCloseTo(may29X + ((june30X - may29X) * 10) / 32);
      expect(cy).toBeGreaterThan(may29Y);
      expect(cy).toBeLessThan(june30Y);
      expect(cy).toBeCloseTo(may29Y + ((june30Y - may29Y) * (cx - may29X)) / (june30X - may29X));
    }
    await act(async () => marker.dispatchEvent(new Event('click', { bubbles: true })));
    expect(
      [...host.querySelectorAll('#holdings-tooltip .tooltip-date')].map((el) => el.textContent),
    ).toEqual(['2 Jun 2026', '3 Jun 2026', '4 Jun 2026', '5 Jun 2026', '8 Jun 2026']);
    expect(
      [...host.querySelectorAll('#holdings-tooltip .holding-transition')].map(
        (el) => el.textContent,
      ),
    ).toEqual([
      '0 (0.00%) → 9.1B (10.57%)+9.1B',
      '9.1B (10.57%) → 10.1B (11.66%)+947.2M',
      '10.1B (11.66%) → 10.8B (12.45%)+676.3M',
      '10.8B (12.45%) → 13.1B (15.10%)+2.3B',
      '13.1B (15.10%) → Below 5%',
    ]);
    expect(host.querySelector('#holdings-tooltip')?.textContent).toContain('SCG CHEMICALS');
    expect(host.querySelector('#holdings-tooltip')?.textContent).toContain('Below 5%');
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(host.querySelector('#holdings-tooltip')).toBeNull();
    for (const event of [
      new FocusEvent('focusin', { bubbles: true }),
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
    ]) {
      await act(async () => marker.dispatchEvent(event));
      expect(host.querySelectorAll('#holdings-tooltip .tooltip-date')).toHaveLength(5);
      await act(async () =>
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      );
    }
    const single = scgLine?.querySelector('[data-date="2026-01-13"]');
    if (!single) throw new Error('Missing SCG January report');
    expect(single.getAttribute('aria-label')).toBe(
      'SCG CHEMICALS PUBLIC COMPANY LIMITED 13 Jan 2026 0 → 9,144,270,316 shares',
    );
    await act(async () => single.dispatchEvent(new Event('click', { bubbles: true })));
    expect(host.querySelectorAll('#holdings-tooltip .tooltip-date')).toHaveLength(1);
    expect(host.querySelector('#holdings-tooltip .tooltip-date')?.textContent).toBe('13 Jan 2026');
    const prajogo = keys.find((el) => el.textContent?.includes('PRAJOGO PANGESTU'));
    const prajogoLine = host.querySelector(
      `.holdings-series[data-holder="${prajogo?.getAttribute('data-holder')}"]`,
    );
    const march16 = prajogoLine?.querySelector('[data-date="2026-03-16"]');
    const step = [...(prajogoLine?.querySelectorAll('.holding-line') ?? [])]
      .map((el) => el.getAttribute('d')?.match(/^M([^,]+),(\S+) H(\S+) V(\S+)$/))
      .find((match) => match && Number(match[3]) === Number(march16?.getAttribute('cx')));
    if (!step) throw new Error('Missing Prajogo March 16 step');
    expect(Number(prajogoLine?.querySelector('[data-date="2026-03-12"]')?.getAttribute('cy'))).toBe(
      Number(step[2]),
    );
    expect(Number(march16?.getAttribute('cy'))).toBe(Number(step[4]));
    const hsbc = keys.find((el) => el.textContent?.includes('HSBC'));
    const hsbcLine = host.querySelector(
      `.holdings-series[data-holder="${hsbc?.getAttribute('data-holder')}"]`,
    );
    expect(hsbcLine?.querySelectorAll('.holding-line')).toHaveLength(0);
    expect(hsbcLine?.querySelectorAll('.holding-anchor')).toHaveLength(1);
    expect(hsbcLine?.querySelector('.holding-label')).toBeNull();
    expect(hsbc?.querySelector('strong')?.textContent).toBe('—');
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

describe('market summary', () => {
  const order = () => stockOrder('#market-rows .stock-link strong');
  it('switches trading windows, sorts both ways with missing values last, searches and shares pins with Home', async () => {
    auth.user = { id: 'market-user', email: 'market@example.com' };
    window.history.replaceState(null, '', '/market');
    await render();
    expect(order()).toEqual(['CCCC', 'BBCA', 'AAAA']);
    expect(host.querySelector('#market-rows a')?.getAttribute('href')).toBe('/t/CCCC');
    expect(fetcher).toHaveBeenCalledWith('/api/brokers?view=market', {
      headers: { Authorization: 'Bearer test-token' },
      cache: 'no-store',
    });
    expect(host.textContent).toContain('20.0%YP');
    await click('.ranges button:nth-child(2)');
    expect(host.querySelector('.ranges button:nth-child(2)')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(host.textContent).toContain('30.0%AA');
    expect(host.textContent).toContain('2.5×');
    expect(host.textContent).toContain('9.0B');
    await click('th:nth-child(3) button');
    expect(order()).toEqual(['BBCA', 'AAAA', 'CCCC']);
    await click('th:nth-child(3) button');
    expect(order()).toEqual(['AAAA', 'BBCA', 'CCCC']);
    await click('.ranges button:nth-child(3)');
    expect(host.textContent).toContain('50.0%BB');
    expect(host.textContent).toContain('15.0B');
    await click('th:nth-child(6) button');
    expect(order()).toEqual(['BBCA', 'AAAA', 'CCCC']);
    await click('th:nth-child(6) button');
    expect(order()).toEqual(['AAAA', 'BBCA', 'CCCC']);
    await typeQuery('company bbca');
    expect(order()).toEqual(['BBCA']);
    await click('[aria-label="Pin BBCA"]');
    expect(JSON.parse(window.localStorage.getItem('vibe-idx:watchlist') ?? 'null')).toEqual([
      'BBCA',
    ]);
    await act(async () => {
      window.history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(host.querySelector('.watch-link')?.getAttribute('href')).toBe('/t/BBCA');
  });
  it('renders and sorts buy size with nulls last and keeps old accumulation payloads readable', async () => {
    auth.user = { id: 'market-user', email: 'market@example.com' };
    window.history.replaceState(null, '', '/market');
    fetcher.mockResolvedValueOnce(Response.json(summary)).mockResolvedValueOnce(
      Response.json({
        ...marketAccumulation,
        stocks: marketAccumulation.stocks.map((stock, i) => ({
          ...stock,
          windows: {
            ...stock.windows,
            '1d': {
              pct: 0.182,
              broker: 'XL',
              size: i === 2 ? null : i === 0 ? 4.1 : 2,
              broker_avg: 12400,
              stock_avg: 3020,
              buy_trades: 214,
              trades: 18512,
            },
          },
        })),
      }),
    );
    await render();
    expect(host.querySelector('th:nth-child(7)')?.textContent).toContain('Buy size');
    const cells = () => [...host.querySelectorAll('#market-rows td:nth-child(7)')];
    expect(cells().map((cell) => cell.textContent)).toEqual(['', '2.0×', '4.1×']);
    expect(cells()[2]?.getAttribute('title')).toBe(
      'XL avg 12,400 shares per buy trade over 214 trades; stock avg 3,020 over 18,512 trades',
    );
    await click('th:nth-child(7) button');
    expect(order()).toEqual(['AAAA', 'BBCA', 'CCCC']);
    expect(host.querySelector('th:nth-child(7)')?.getAttribute('aria-sort')).toBe('descending');
    await click('th:nth-child(7) button');
    expect(order()).toEqual(['BBCA', 'AAAA', 'CCCC']);
    expect(host.querySelector('th:nth-child(7)')?.getAttribute('aria-sort')).toBe('ascending');
    await click('.ranges button:nth-child(2)');
    expect(host.textContent).toContain('30.0%AA');
    expect(cells().map((cell) => cell.textContent)).toEqual(['', '', '']);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it('keeps prices and sorting public, offers sign-in once and never requests private data while signed out', async () => {
    window.history.replaceState(null, '', '/market');
    await render();
    expect(order()).toHaveLength(3);
    expect(host.textContent).toContain('3.0B');
    expect(host.querySelectorAll('.accumulation-gate button')).toHaveLength(1);
    expect(
      [...host.querySelectorAll('button')].filter((button) => button.textContent === 'Sign in'),
    ).toHaveLength(1);
    expect(host.querySelector('.broker')).toBeNull();
    expect(host.querySelector('th:nth-child(7)')?.textContent).toBe('');
    expect(
      [...host.querySelectorAll('#market-rows td:nth-child(7)')].every(
        (cell) => cell.textContent === '',
      ),
    ).toBe(true);
    await click('.ranges button:nth-child(2)');
    await click('th:nth-child(3) button');
    expect(order()).toEqual(['BBCA', 'AAAA', 'CCCC']);
    expect(auth.getAccessToken).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.every(([url]) => !url.includes('/api/brokers'))).toBe(true);
    await click('.accumulation-gate button');
    expect(window.sessionStorage.getItem('vibe-idx-return-to')).toBe('/market');
  });
});
