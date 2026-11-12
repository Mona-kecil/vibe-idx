// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { App } from './App';
import { arrivalMs } from './Corruption';
import { tickerSchema, type Feed, type Ticker } from './data';
import { HoldingsChart } from './ticker/Ownership';
import { holdingSeries } from './ticker/logic';
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
// Exercise the workspace without the chart library's browser-only canvas APIs.
vi.mock('./terminal/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./terminal/charts')>();
  const chart: object = new Proxy(() => chart, {
    get: (_, key) => (key === 'then' ? undefined : key === Symbol.toPrimitive ? () => 0 : chart),
    apply: () => chart,
  });
  return { ...actual, terminalChart: () => chart, publicChart: () => chart };
});
const dates = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'];
const row = (broker: string, shares: number) => ({
  broker,
  investor: 'domestic',
  broker_type: 'local',
  shares,
  value: shares * 100,
  avg_price: 100,
  freq: 1,
});
const days = [
  ...dates.map((date) => ({
    date,
    board: 'regular',
    buy: [row('AK', 500), row('SQ', 200)],
    sell: [row('PD', 400), row('CC', 300)],
  })),
  { date: dates[3], board: 'negotiation', buy: [row('AK', 900)], sell: [row('YP', 900)] },
];
function ticker(symbol: string): Ticker {
  return {
    ticker: symbol,
    name: `Company ${symbol}`,
    prices: dates.map((date, i) => ({
      date,
      open: null,
      high: null,
      low: null,
      close: 100 + i,
      volume: 700,
      value: 70000,
      net_foreign: 0,
    })),
    holders: [
      { investor: 'Synthetic holder', holder_key: 'SYNTHETIC HOLDER', shares: 100, pct: 10 },
    ],
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
const riskFlags = {
  AAAA: {
    notes: [{ code: 'X', text: 'Special monitoring' }],
    susp: null,
    uma: { date: '2026-10-22', url: 'https://example.com/uma' },
  },
  CCCC: {
    notes: [],
    susp: { since: '2026-10-20', reason: null, url: 'https://example.com/susp' },
    uma: null,
  },
};
const weekEvent = (ts: string, ev: string, imp: number, extra: object = {}) => ({
  ts,
  c: 'US',
  imp,
  ev,
  url: 'https://example.com/event',
  by: 'Example Source',
  ...extra,
});
const weekAction = (ticker: string, kind: string, step: string, date: string) => ({
  ticker,
  kind,
  label: `${kind} ${ticker}`,
  amount: null,
  steps: [{ step, date }],
});
const weekCalendar = {
  cal: [
    weekEvent('2026-11-12T13:30:00Z', 'Yesterday release', 3),
    weekEvent('2026-11-13T01:00:00Z', 'Already out', 3),
    weekEvent('2026-11-13T13:30:00Z', 'Core PPI m/m', 3),
    weekEvent('2026-11-14T01:00:00Z', 'Retail sales', 2),
    weekEvent('2026-11-17T17:00:00Z', 'BI rate decision', 3, {
      c: 'ID',
      est: 'Date only; release time not published by source',
    }),
    weekEvent('2026-11-20T01:00:00Z', 'Next week release', 3),
  ],
};
const weekActions = [
  weekAction('AAAA', 'DIV', 'ex', '2026-11-16'),
  weekAction('BBBB', 'RIGHTS', 'ex', '2026-11-14'),
  weekAction('CCCC', 'RUPS', 'meeting', '2026-11-13T14:00'),
  weekAction('DDDD', 'DIV', 'ex', '2026-11-12'),
  weekAction('EEEE', 'DIV', 'ex', '2026-11-25'),
  weekAction('FFFF', 'IPO', 'listing', '2026-11-14'),
  weekAction('GGGG', 'DIV', 'cum', '2026-11-15'),
  weekAction('HHHH', 'BONUS', 'ex', '2026-11-15'),
  weekAction('IIII', 'SPLIT', 'ex', '2026-11-15'),
];
const fetcher = vi.fn<(input: string) => Promise<Response>>(async (input) => {
  const url = String(input);
  if (url.includes('calendar.json')) return Response.json(weekCalendar);
  if (url.includes('corporate-actions.json')) return Response.json(weekActions);
  if (url.includes('risk.json')) return Response.json(riskFlags);
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
async function typeQuery(query: string, selector = 'input[type="search"]') {
  await act(async () => {
    const input = element(selector, HTMLInputElement);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeAll(async () => {
  await import('./ticker/TickerPage');
});
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
  const baseFetch = fetcher.getMockImplementation()!;
  const tiles = () =>
    [...host.querySelectorAll('.tile')].map((tile) => ({
      tag: tile.querySelector('.tile-head b')?.textContent,
      count: tile.querySelector('.tile-head .num')?.textContent,
      href: tile.querySelector('.tile-head')?.getAttribute('href'),
      rows: [...tile.querySelectorAll('.tile-row')].map((row) => ({
        ticker: row.querySelector('.sym')?.textContent,
        href: row.getAttribute('href'),
        width: row.querySelector<HTMLElement>('.mag i')?.style.width,
      })),
    }));
  const weekRows = () =>
    [...host.querySelectorAll('.week li')].map((li) => li.textContent?.replace(/\s+/g, ' '));
  const pin = (...tickers: string[]) =>
    window.localStorage.setItem('vibe-idx:watchlist', JSON.stringify(tickers));
  function viewport(width: number) {
    const matchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const media = matchMedia(query);
      vi.spyOn(media, 'matches', 'get').mockReturnValue(
        query === '(max-width: 900px)' && width <= 900,
      );
      return media;
    });
  }
  const serve = (path: string, body: unknown) =>
    fetcher.mockImplementation(async (input) =>
      String(input).includes(path) ? Response.json(body) : baseFetch(input),
    );
  const today = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
  };
  afterEach(() => {
    vi.useRealTimers();
    fetcher.mockImplementation(baseFetch);
  });

  it('shows one tile per kind with distinct stocks counted, the top three by strength, scaled bars and links', async () => {
    feed = [
      volume('HHHH', 7),
      ara('BBBB', 30),
      volume('IIII', 9),
      volume('IIII', 3),
      ara('AAAA', 40),
      ara('CCCC', 20),
      ara('DDDD', 10),
      {
        ticker: 'JJJJ',
        date: dates[3],
        kind: 'foreign_streak',
        numbers: { streak_days: 7, net_foreign: 1e8 },
      },
      ownership('CCCC', 'Exit holder', 15, null, { exited: true, net_shares: 123 }),
      ownership('DDDD', 'PT Alpha Tbk.', 6, 8),
      ownership('DDDD', 'Alpha', 6, 9),
      ownership('EEEE', 'Unchanged', 6.001, 6.002),
      { ...ownership('FFFF', 'Old filing', 5, 99), date: '2026-10-21' },
      ownership('UNKNOWN', 'Missing stock', 5, 6),
      { kind: 'future_signal', ticker: 'BBCA', numbers: {} },
    ];
    await render();
    expect(tiles()).toEqual([
      {
        tag: 'ARA',
        count: '4',
        href: '/market?show=ara',
        rows: [
          { ticker: 'AAAA', href: '/t/AAAA', width: '100%' },
          { ticker: 'BBBB', href: '/t/BBBB', width: '75%' },
          { ticker: 'CCCC', href: '/t/CCCC', width: '50%' },
        ],
      },
      {
        tag: 'Volume',
        count: '2',
        href: '/market?show=volume_spike',
        rows: [
          { ticker: 'IIII', href: '/t/IIII', width: '100%' },
          { ticker: 'HHHH', href: '/t/HHHH', width: expect.stringMatching(/^77\.7/) },
        ],
      },
      {
        tag: 'Foreign',
        count: '1',
        href: '/market?show=foreign_streak',
        rows: [{ ticker: 'JJJJ', href: '/t/JJJJ', width: '100%' }],
      },
      {
        tag: '5%',
        count: '2',
        href: '/market?show=five_pct_change',
        rows: [
          { ticker: 'CCCC', href: '/t/CCCC', width: '100%' },
          { ticker: 'DDDD', href: '/t/DDDD', width: expect.any(String) },
        ],
      },
    ]);
    const exit = host.querySelectorAll('.tile')[3]!.querySelector('.tile-row');
    expect(exit?.textContent).toContain('15.00 → <5%');
    expect(host.querySelector('a a')).toBeNull();
    expect(host.querySelector('.tabs')).toBeNull();
    expect(host.textContent).not.toContain('Old filing');
    expect(host.textContent).not.toContain('Missing stock');
    expect(host.querySelector('.sources')?.textContent).toContain('1 feed record excluded');
  });
  it('says when the latest day has no signals', async () => {
    await render();
    expect(host.querySelectorAll('.tile')).toHaveLength(0);
    expect(host.querySelector('.signals-empty')?.textContent).toBe('No signals on the latest day.');
  });
  it('shows the watchlist right under the pulse line with each stock risk badge', async () => {
    pin('AAAA', 'BBBB');
    await render();
    const watchlist = element('.watchlist', HTMLElement);
    expect(watchlist.previousElementSibling?.classList.contains('pulse')).toBe(true);
    expect(watchlist.nextElementSibling?.classList.contains('today')).toBe(true);
    const [first, second] = [...watchlist.querySelectorAll('.watch-row')];
    expect(first?.querySelector('.watch-name .sym')?.textContent).toBe('AAAA');
    expect(
      [...(first?.querySelectorAll('.watch-name .risk-chip') ?? [])].map((c) => c.textContent),
    ).toEqual(['UMA', 'FCA']);
    expect(second?.querySelector('.risk')).toBeNull();
  });
  it('lists high-impact events and ex-dates of the next seven days in date order', async () => {
    today('2026-11-13T03:00:00Z');
    await render();
    expect(weekRows()).toEqual([
      '13 NovUSCore PPI m/m20:30 WIB',
      '14 NovBBBBRIGHTSRIGHTS BBBB',
      '15 NovHHHHBONUSBONUS HHHH',
      '15 NovIIIISPLITSPLIT IIII',
      '16 NovAAAADIVDIV AAAA',
      '18 NovIDBI rate decision',
    ]);
    expect(host.querySelector('.week .more')?.textContent).toBe('1 more in Terminal');
    expect(host.querySelector('.week a[href="/t/BBBB"]')).not.toBeNull();
    for (const hidden of [
      'Yesterday',
      'Already out',
      'Retail',
      'Next week',
      'DDDD',
      'EEEE',
      'FFFF',
      'GGGG',
    ])
      expect(host.querySelector('.week')?.textContent).not.toContain(hidden);
  });
  it('puts pinned tickers first and keeps unpinned shareholder meetings last', async () => {
    today('2026-11-13T03:00:00Z');
    pin('CCCC', 'AAAA');
    await render();
    expect(weekRows().map((r) => r?.slice(0, 11))).toEqual([
      '13 NovCCCCR',
      '16 NovAAAAD',
      '13 NovUSCor',
      '14 NovBBBBR',
      '15 NovHHHHB',
      '15 NovIIIIS',
    ]);
    expect(
      [...host.querySelectorAll('.week .pinned')].map((li) => li.textContent?.slice(6, 10)),
    ).toEqual(['CCCC', 'AAAA']);
  });
  it('keeps the terminal link off phones and renders nothing when the week is empty', async () => {
    today('2026-11-13T03:00:00Z');
    viewport(390);
    await render();
    expect(weekRows()).toHaveLength(6);
    expect(host.querySelector('.week .more')).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(host);
    today('2027-03-01T03:00:00Z');
    await render();
    expect(host.querySelector('.week')).toBeNull();
  });
  it('limits the heatmap to the 20 most traded stocks on phones and 50 on desktop, each labelled', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ticker: `T${String(i).padStart(3, '0')}`,
      name: `Company ${i}`,
      close: 100,
      change_pct: 1.5,
      volume: 1,
      value: (i + 1) * 1e9,
      net_foreign: 0,
    }));
    serve('tickers.json', many);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    await render();
    expect(host.querySelectorAll('.heat a')).toHaveLength(50);
    await act(async () => root.unmount());
    root = createRoot(host);
    viewport(390);
    await render();
    const tilesOnPhone = [...host.querySelectorAll('.heat a')];
    expect(tilesOnPhone).toHaveLength(20);
    expect(tilesOnPhone[0]?.textContent).toBe('T059+1.50%');
    expect(tilesOnPhone.every((a) => /^T\d{3}\+1\.50%$/.test(a.textContent ?? ''))).toBe(true);
    expect(tilesOnPhone.at(-1)?.getAttribute('href')).toBe('/t/T040');
  });
  it('limits news to 6 items on phones and 12 on desktop', async () => {
    const news = Array.from({ length: 14 }, (_, i) => ({
      ts: `2026-11-12T${String(10 + (i % 10)).padStart(2, '0')}:00:00+07:00`,
      src: 'Antara',
      title: `Headline ${i}`,
      link: `https://example.com/${i}`,
      region: 'ID',
      tags: [],
    }));
    serve('news.json', { news });
    await render();
    expect(host.querySelectorAll('.news li')).toHaveLength(12);
    await act(async () => root.unmount());
    root = createRoot(host);
    viewport(390);
    await render();
    expect(host.querySelectorAll('.news li')).toHaveLength(6);
  });
  it('draws advancers against decliners as a split bar that carries both numbers', async () => {
    serve('market.json', {
      date: dates.at(-1),
      up: 3,
      down: 1,
      history: dates.map((date) => ({ date, close: 5000, change: 10, change_pct: 1 })),
    });
    await render();
    const breadth = element('.breadth', HTMLElement);
    expect(breadth.getAttribute('aria-label')).toBe('3 up, 1 down');
    expect(
      [...breadth.querySelectorAll<HTMLElement>('.split span')].map((s) => s.style.flexGrow),
    ).toEqual(['3', '1']);
  });
  it.each([
    [[5000, 5100, 5200, 5160], 'up', '+3.20% 60D'],
    [[5000, 4900, 4800, 4845], 'down', '−3.10% 60D'],
    [[5000, 5100, 4900, 5002], 'flat', '+0.04% 60D'],
  ])(
    'colours the IHSG area by its window change %j and prints the number',
    async (closes, tone, text) => {
      serve('market.json', {
        date: dates.at(-1),
        up: 1,
        down: 1,
        history: dates.map((date, i) => ({
          date,
          close: closes[i],
          change: 10,
          change_pct: 1,
        })),
      });
      await render();
      const spark = element('.pulse .spark', SVGSVGElement);
      expect(spark.dataset.tone).toBe(tone);
      expect(spark.querySelector('title')?.textContent?.split('; ').at(-1)).toBe(
        `22 Oct 2026: ${(closes.at(-1) ?? 0).toLocaleString('en-US')}.00`,
      );
      const change = element('.pulse .spark-change', HTMLElement);
      expect(change.dataset.tone).toBe(tone);
      expect(change.textContent).toBe(text);
    },
  );
  it('gives every spark its own gradient and tones the watchlist rows', async () => {
    pin('AAAA', 'BBBB');
    await render();
    const sparks = [...host.querySelectorAll('svg.spark')];
    expect(sparks).toHaveLength(3);
    const ids = sparks.map((svg) => svg.querySelector('linearGradient')?.id);
    expect(new Set(ids).size).toBe(3);
    sparks.forEach((svg, i) =>
      expect(svg.querySelector('.spark-fill')?.getAttribute('fill')).toBe(`url(#${ids[i]})`),
    );
    expect(
      [...host.querySelectorAll<SVGSVGElement>('.watch-row svg.spark')].map((s) => s.dataset.tone),
    ).toEqual(['up', 'up']);
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
    expect(host.querySelectorAll('.watch-row')).toHaveLength(1);
    expect(host.querySelector('.watch-row .close')?.textContent).toBe('100');
    expect(host.querySelector('.watch-row .latest-event')?.textContent).toContain(
      'Newer disclosure',
    );
    expect(host.querySelector('.watch-row svg')).not.toBeNull();
    await click('.watch-row [aria-label="Unpin BBCA"]');
    expect(host.querySelectorAll('.watch-row')).toHaveLength(0);
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(host.querySelectorAll('.watch-row')).toHaveLength(0);
    await typeQuery('BBCA');
    await click('.search-results [aria-label="Pin BBCA"]');
    expect(host.querySelectorAll('.watch-row')).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem('vibe-idx:watchlist') ?? 'null')).toEqual([
      'BBCA',
    ]);
  });
  it('keeps the briefing, tiles and pins working when sandbox storage throws', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    feed = [ownership('AAAA', 'Holder', 5, 6)];
    await render();
    expect(host.querySelector('h1')?.textContent).toBe('IHSG');
    await typeQuery('AAAA');
    await click('.search-results [aria-label="Pin AAAA"]');
    expect(host.querySelector('.watch-row')).not.toBeNull();
    expect(tiles().map((t) => t.tag)).toEqual(['5%']);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('terminal availability', () => {
  function desktop(reducedMotion = false) {
    const matchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const media = matchMedia(query);
      vi.spyOn(media, 'matches', 'get').mockReturnValue(
        query === '(prefers-reduced-motion: reduce)' ? reducedMotion : true,
      );
      return media;
    });
    window.history.replaceState(null, '', '/terminal');
  }
  async function openTerminal() {
    await render();
    await act(async () => {
      await vi.dynamicImportSettled();
    });
  }
  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
  afterEach(() => {
    vi.useRealTimers();
  });

  it('covers the desktop load with one loading announcement and keeps fast loads through the minimum and fade', async () => {
    vi.useFakeTimers();
    desktop();
    await openTerminal();
    expect(host.querySelector('.terminal-boot canvas[aria-hidden="true"]')).not.toBeNull();
    expect(
      [...host.querySelectorAll('[role="status"]')].filter(
        (node) => node.textContent === 'Loading terminal…',
      ),
    ).toHaveLength(1);
    expect(host.querySelector('.term')).not.toBeNull();
    expect(host.querySelector('.term')?.closest('[inert]')).not.toBeNull();
    await advance(799);
    expect(host.querySelector('.terminal-boot')).not.toBeNull();
    await advance(1);
    expect(host.querySelector('.terminal-boot')).not.toBeNull();
    await advance(449);
    expect(host.querySelector('.terminal-boot')).not.toBeNull();
    await advance(1);
    expect(host.querySelector('.terminal-boot')).toBeNull();
    expect(host.querySelector('.term')).not.toBeNull();
    expect(host.querySelector('[inert]')).toBeNull();
    expect(host.textContent).not.toContain('Loading terminal…');
  });

  it('waits for slow data even after the minimum has elapsed', async () => {
    vi.useFakeTimers();
    desktop();
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const baseFetch = fetcher.getMockImplementation();
    if (!baseFetch) throw new Error('Missing fixture fetcher');
    fetcher.mockImplementationOnce(async (input) => {
      await pending;
      return baseFetch(input);
    });
    await openTerminal();
    await advance(1500);
    expect(host.querySelector('.terminal-boot')).not.toBeNull();
    await act(async () => {
      release();
    });
    await advance(450);
    expect(host.querySelector('.terminal-boot')).toBeNull();
    expect(host.querySelector('.term')).not.toBeNull();
  });

  it('reveals the workspace immediately when reduced motion is requested', async () => {
    vi.useFakeTimers();
    desktop(true);
    await openTerminal();
    expect(host.querySelector('.terminal-boot')).toBeNull();
    expect(host.querySelector('.term')).not.toBeNull();
    expect(host.querySelector('[inert]')).toBeNull();
  });

  it('covers the home page from the Terminal button and opens the terminal without a reload', async () => {
    vi.useFakeTimers();
    desktop();
    window.history.replaceState(null, '', '/');
    await render();
    await act(async () => host.querySelector<HTMLAnchorElement>('a.terminal-link')?.click());
    expect(document.querySelector('.terminal-veil')).toBeNull();
    await advance(300);
    expect(document.querySelector('.terminal-veil')).not.toBeNull();
    expect(window.location.pathname).toBe('/');
    await advance(arrivalMs());
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(window.location.pathname).toBe('/terminal');
    expect(document.querySelector('.terminal-veil')).toBeNull();
    expect(host.querySelector('.terminal-boot')).not.toBeNull();
  });

  it('reveals the failed data request and keeps retry loading plain', async () => {
    vi.useFakeTimers();
    desktop();
    fetcher.mockRejectedValueOnce(new Error('Offline'));
    await openTerminal();
    expect(host.querySelector('.terminal-boot')).not.toBeNull();
    await advance(800);
    await advance(450);
    expect(host.querySelector('.terminal-boot')).toBeNull();
    expect(host.querySelector('[inert]')).toBeNull();
    expect(host.textContent).toContain('Terminal data unavailable');
    expect(host.querySelector('.empty button')?.textContent).toBe('Retry');
    let fail = (_error: Error) => {};
    fetcher.mockReturnValueOnce(
      new Promise<Response>((_resolve, reject) => {
        fail = reject;
      }),
    );
    await click('.empty button');
    expect(host.querySelector('.terminal-boot')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading terminal…');
    await act(async () => {
      fail(new Error('Still offline'));
    });
    expect(host.textContent).toContain('Terminal data unavailable');
  });

  it('blocks mobile data requests and reacts when the desktop media query changes', async () => {
    const media = window.matchMedia('(min-width: 901px)');
    const matches = vi.spyOn(media, 'matches', 'get').mockReturnValue(false);
    vi.spyOn(window, 'matchMedia').mockReturnValue(media);
    window.history.replaceState(null, '', '/terminal?t=BBCA&l=focus');
    await render();
    expect(host.textContent).toContain('The terminal is not available on mobile yet.');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/');
    expect(host.querySelector('.terminal-boot')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRejectedValueOnce(new Error('Offline'));
    await act(async () => {
      matches.mockReturnValue(true);
      media.dispatchEvent(new Event('change'));
      await vi.dynamicImportSettled();
    });
    expect(host.querySelector('.terminal-page')).not.toBeNull();
    expect(host.querySelector('.terminal-unavailable')).toBeNull();
    expect(window.location.search).toBe('?t=BBCA&l=focus');
    await act(async () => {
      matches.mockReturnValue(false);
      media.dispatchEvent(new Event('change'));
    });
    expect(host.textContent).toContain('The terminal is not available on mobile yet.');
    expect(host.querySelector('.terminal-page')).toBeNull();
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
    expect(JSON.parse(window.localStorage.getItem('vibe-idx:watchlist') ?? '[]')).toEqual([]);
    await act(async () => {
      window.history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(host.querySelector('h1')?.textContent).toBe('IHSG');
    expect(host.querySelector('a.terminal-link')?.getAttribute('href')).toBe('/terminal');
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
  it('orders identity, chart, key stats, ownership, timeline and a compact broker row', async () => {
    window.history.replaceState(null, '', '/t/BBCA');
    await render();
    const order = [
      '.ticker-header',
      '#price-section',
      '.stats-block',
      '#ownership-section',
      '#timeline-section',
      '#broker-section',
    ];
    const nodes = order.map((selector) => element(selector, HTMLElement));
    nodes
      .slice(1)
      .forEach((node, i) =>
        expect(
          nodes[i]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy(),
      );
    expect(host.querySelector('.ticker-header .pin')?.getAttribute('aria-label')).toBe('Pin BBCA');
    expect(
      [...host.querySelectorAll('.stats-block > .stats .stat dt')].map((dt) => dt.textContent),
    ).toEqual(['ValueIDR', 'Net foreignIDR (est.)', 'Free float']);
    expect(host.querySelector('.more-stats')?.hasAttribute('open')).toBe(false);
    expect(element('#broker-section', HTMLElement).className).toBe('broker-compact');
    expect(element('#broker-section', HTMLElement).textContent).toBe('Broker flowSign in');
    await click('.ticker-header .pin');
    expect(JSON.parse(window.localStorage.getItem('vibe-idx:watchlist') ?? '[]')).toEqual(['BBCA']);
  });
  it('keeps source dates behind the price date and shows a warning only for a stale source', async () => {
    const base = fetcher.getMockImplementation();
    const run = (run_at: string) =>
      fetcher.mockImplementation(async (input) =>
        String(input).includes('health.json')
          ? Response.json({
              prices: dates.at(-1),
              indices: dates.at(-1),
              five_pct: dates.at(-1),
              one_pct: '2026-09-30',
              issuers: dates.at(-1),
              run_at,
            })
          : base!(input),
      );
    window.history.replaceState(null, '', '/t/BBCA');
    run(new Date().toISOString());
    await render();
    expect(host.querySelector('.ticker-header .stale')).toBeNull();
    const panel = element('.freshness', HTMLDetailsElement);
    expect(panel.open).toBe(false);
    expect(panel.querySelector('summary')?.textContent).toBe('22 Oct 2026');
    expect(panel.querySelector('.freshness-panel')?.textContent).toContain('Prices22 Oct 2026');
    await act(async () => root.render(null));
    run('2020-01-01T10:30:00Z');
    await render();
    expect(host.querySelector('.ticker-header .stale')?.textContent).toContain(
      'Not updated since 1 Jan 2020',
    );
    fetcher.mockImplementation(base!);
  });
  it('caps holders at five', async () => {
    window.history.replaceState(null, '', '/t/BBCA');
    await render();
    expect(element('.chart-host', HTMLElement).dataset.bars).toBe(String(dates.length));
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(948);
    history = tickerSchema.parse(tpiaFixture);
    window.history.replaceState(null, '', '/t/TPIA');
    await act(async () => root.render(null));
    await render();
    expect(host.querySelectorAll('#holders li')).toHaveLength(5);
    expect(host.querySelectorAll('.holder-key')).toHaveLength(5);
    expect(element('#ownership-section .show-all', HTMLButtonElement).textContent).toBe(
      'Show all 6',
    );
    await click('#ownership-section .show-all');
    expect(host.querySelectorAll('#holders li')).toHaveLength(6);
    expect(
      host.querySelector('.holdings-mode [aria-pressed="true"]')?.getAttribute('data-unit'),
    ).toBe('pct');
  });
  it('merges filings and news into one newest-first timeline of five with a show-all', async () => {
    const filing = (n: number) => ({
      id: `f${n}`,
      title: `Filing ${n}`,
      published_at: `2026-10-0${n}T10:00:00`,
      url: `https://example.com/f${n}.pdf`,
      kind: 'other' as const,
      attachments: [],
    });
    history = { ...ticker('BBCA'), disclosures: [1, 2, 3, 4].map(filing) };
    const base = fetcher.getMockImplementation();
    fetcher.mockImplementation(async (input) =>
      String(input).includes('/api/news')
        ? Response.json(
            [5, 6, 7].map((n) => ({
              title: `News ${n}`,
              url: `https://example.com/n${n}`,
              published_at: `2026-10-0${n}T12:00:00Z`,
              source: 'Wire',
            })),
          )
        : base!(input),
    );
    window.history.replaceState(null, '', '/t/BBCA');
    await render();
    await act(() => new Promise((resolve) => setTimeout(resolve, 350)));
    const rows = () => [...host.querySelectorAll('#timeline li')];
    expect(
      rows().map((li) => [
        li.getAttribute('data-kind'),
        li.querySelector('.feed-title')?.textContent,
      ]),
    ).toEqual([
      ['news', 'News 7'],
      ['news', 'News 6'],
      ['news', 'News 5'],
      ['filing', 'Filing 4'],
      ['filing', 'Filing 3'],
    ]);
    expect(rows()[0]?.querySelector('.kind')).toBeNull();
    expect(rows()[3]?.querySelector('.kind')?.textContent).toBe('Filing');
    await click('#timeline-toggle');
    expect(rows()).toHaveLength(7);
    expect(element('#timeline-toggle', HTMLButtonElement).textContent).toBe('Show less');
    fetcher.mockImplementation(base!);
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
      const cx = Number(marker.getAttribute('cx'));
      const diagonal = [...(scgLine?.querySelectorAll('.holding-uncertain') ?? [])]
        .map((path) => path.getAttribute('d')?.match(/^M([^,]+),(\S+) L([^,]+),(\S+)$/))
        .find((path) => path && Number(path[1]) < cx && Number(path[3]) > cx);
      if (!diagonal) throw new Error('Missing SCG May 29–June 30 diagonal');
      const may29X = Number(diagonal[1]),
        may29Y = Number(diagonal[2]),
        june30X = Number(diagonal[3]),
        june30Y = Number(diagonal[4]),
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
      '9.1B (10.57%) → 10.1B (11.67%)+947.2M',
      '10.1B (11.67%) → 10.8B (12.45%)+676.3M',
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
    expect(host.querySelectorAll('.holder-key').length).toBeLessThanOrEqual(5);
    expect(keys.some((el) => el.textContent?.includes('HSBC'))).toBe(false);
  });
  it('draws full TPIA holder lines as steps and anchors without extending HSBC', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(948);
    const data = tickerSchema.parse(tpiaFixture);
    const series = holdingSeries(data, '2026-10-26');
    await act(async () =>
      root.render(<HoldingsChart data={data} series={series} selection={null} end="2026-10-26" />),
    );
    const keys = [...host.querySelectorAll('.holder-key')];
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
    expect(rows[0]?.textContent).toContain('200.0K');
    expect(rows[0]?.textContent).not.toContain('+');
    const cells = (side: string) =>
      [...host.querySelectorAll(`.broker-ledger.${side} tbody tr:first-child td`)].map(
        (td) => td.textContent,
      );
    expect(cells('sell').slice(1)).toEqual(['160.0K', '16', '100.0']);
    const volume = host.querySelector('.broker-ledger.sell tbody tr:first-child td:nth-child(3)');
    expect(volume?.getAttribute('title')).toBe('1,600 shares');
    expect(host.querySelector('.broker-ledger th:nth-child(3)')?.textContent).toBe('Vol lot');
    expect(cells('buy')[0]).toContain('UBS Sekuritas Indonesia');
    const board = (label: string) =>
      click(
        `.broker-board button:nth-child(${['Regular', 'Negotiation', 'Cash', 'All'].indexOf(label) + 1})`,
      );
    expect(
      [...host.querySelectorAll('.broker-board button')].map((b) => [
        b.textContent,
        b.getAttribute('aria-pressed'),
      ]),
    ).toEqual([
      ['Regular', 'true'],
      ['Negotiation', 'false'],
      ['Cash', 'false'],
      ['All', 'false'],
    ]);
    await board('Negotiation');
    expect(host.querySelectorAll('#broker-section tbody tr')).toHaveLength(2);
    expect(cells('buy').slice(1)).toEqual(['90.0K', '9', '100.0']);
    await board('Cash');
    expect(host.querySelector('#broker-section .empty-state')?.textContent).toBe(
      'No trades reported in this period',
    );
    expect(host.querySelector('.broker-board')).not.toBeNull();
    await board('All');
    expect(host.querySelectorAll('#broker-section tbody tr')).toHaveLength(5);
    expect(cells('buy').slice(1, 3)).toEqual(['290.0K', '29']);
    await board('Regular');
    await click('.broker-unit button:nth-child(2)');
    expect([cells('buy').slice(1, 3), cells('sell').slice(1, 3)]).toEqual([
      ['200.0K', '20'],
      ['160.0K', '16'],
    ]);
    const dimmed = () =>
      [...host.querySelectorAll('#broker-section tbody tr')].map(
        (tr) =>
          `${tr.querySelector('td')?.firstChild?.textContent}${tr.classList.contains('dim') ? '-' : ''}`,
      );
    const tap = (side: string) =>
      act(async () =>
        element(`.broker-ledger.${side} tbody tr:first-child td`, HTMLElement).click(),
      );
    await tap('buy');
    expect(dimmed()).toEqual(['AK', 'SQ-', 'PD-', 'CC-']);
    await tap('buy');
    expect(dimmed()).toEqual(['AK', 'SQ', 'PD', 'CC']);
    await tap('sell');
    expect(dimmed()).toEqual(['AK-', 'SQ-', 'PD', 'CC-']);
    await click('.broker-unit button:nth-child(1)');
    expect(dimmed()).toEqual(['AK', 'SQ', 'PD', 'CC']);
    await tap('buy');
    expect(dimmed()).toEqual(['AK', 'SQ', 'PD', 'CC']);
    await click('.broker-unit button:nth-child(2)');
    expect(host.querySelector('#timeline')?.textContent).not.toContain('No filings or news');
    await act(() => new Promise((resolve) => setTimeout(resolve, 350)));
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/api/news?ticker=BBCA'))).toBe(
      true,
    );
    expect(host.querySelector('#timeline')?.textContent).toContain('No filings or news');
    expect(
      element('#timeline-section', HTMLElement).compareDocumentPosition(
        element('#broker-section', HTMLElement),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    const code = host.querySelector<HTMLElement>('.broker-ledger.buy tbody td')!;
    await act(async () => {
      code.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(host.querySelector('.broker-tip')?.textContent).toBe('PT UBS Sekuritas Indonesia');
    await act(async () => {
      code.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    });
    expect(host.querySelector('.broker-tip')).toBeNull();
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
    await typeQuery('company bbca', '.filter');
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
    const baseFetch = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (input) =>
      !String(input).includes('/api/brokers?view=market')
        ? baseFetch(input)
        : Response.json({
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
    expect(host.querySelector('th:nth-child(8)')?.textContent).toContain('Buy size');
    const cells = () => [...host.querySelectorAll('#market-rows td:nth-child(8)')];
    expect(cells().map((cell) => cell.textContent)).toEqual(['', '2.0×', '4.1×']);
    expect(cells()[2]?.getAttribute('title')).toBe(
      'XL avg 12,400 shares per buy trade over 214 trades; stock avg 3,020 over 18,512 trades',
    );
    await click('th:nth-child(8) button');
    expect(order()).toEqual(['AAAA', 'BBCA', 'CCCC']);
    expect(host.querySelector('th:nth-child(8)')?.getAttribute('aria-sort')).toBe('descending');
    await click('th:nth-child(8) button');
    expect(order()).toEqual(['BBCA', 'AAAA', 'CCCC']);
    expect(host.querySelector('th:nth-child(8)')?.getAttribute('aria-sort')).toBe('ascending');
    await click('.ranges button:nth-child(2)');
    expect(host.textContent).toContain('30.0%AA');
    expect(cells().map((cell) => cell.textContent)).toEqual(['', '', '']);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    fetcher.mockImplementation(baseFetch);
  });
  it('keeps prices and sorting public, hides broker columns and never requests private data while signed out', async () => {
    window.history.replaceState(null, '', '/market');
    await render();
    expect(order()).toHaveLength(3);
    expect(host.textContent).toContain('3.0B');
    expect(stockOrder('th')).toEqual([
      'Stock',
      'CloseIDR',
      'Change %',
      'Value tradedIDR↓',
      'Net foreignIDR',
      'Volume × average',
      'Pin',
    ]);
    expect(
      [...host.querySelectorAll('button')].filter((button) => button.textContent === 'Sign in'),
    ).toHaveLength(1);
    await click('.ranges button:nth-child(2)');
    await click('th:nth-child(3) button');
    expect(order()).toEqual(['BBCA', 'AAAA', 'CCCC']);
    expect(auth.getAccessToken).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.every(([url]) => !url.includes('/api/brokers'))).toBe(true);
    await click('.site-account button');
    expect(window.sessionStorage.getItem('vibe-idx-return-to')).toBe('/market');
  });
  it('opens a signal view from the URL, ranks it by strength and clears it from the address on All', async () => {
    feed = [
      ara('AAAA', 30),
      ara('CCCC', 40),
      volume('BBCA', 5),
      ownership('UNKNOWN', 'Untraded', 5, 6),
    ];
    window.history.replaceState(null, '', '/market?show=ara');
    await render();
    expect(order()).toEqual(['CCCC', 'AAAA']);
    expect(host.querySelector('th:nth-child(2)')?.textContent).toContain('Signal');
    expect(host.querySelector('#market-rows td.event')?.textContent).toContain('+40.0% ARA');
    expect(stockOrder('.toolbar .tabs button')).toEqual(['All', 'ARA 2', 'Volume 1']);
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('.toolbar .tabs button')]
        .find((b) => b.textContent === 'All')!
        .click(),
    );
    expect(window.location.search).toBe('');
    expect(order()).toEqual(['CCCC', 'BBCA', 'AAAA']);
    expect(host.querySelector('td.event')).toBeNull();
  });
  let restoreFetch = () => {};
  afterEach(() => restoreFetch());
  function stubData(overrides: Record<string, unknown>) {
    const base = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (input) => {
      const hit = Object.entries(overrides).find(([part]) => String(input).includes(part));
      return hit ? Response.json(hit[1]) : base(input);
    });
    restoreFetch = () => fetcher.mockImplementation(base);
  }
  const listeners = new Set<EventListener>();
  let viewport = 1024;
  function fakeViewport(width: number) {
    viewport = width;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const bound = (kind: 'min' | 'max') =>
        Number(new RegExp(`${kind}-width: (\\d+)px`).exec(query)?.[1]);
      const matches = () =>
        query.includes('max-width')
          ? viewport <= bound('max')
          : query.includes('min-width') && viewport >= bound('min');
      return {
        media: query,
        get matches() {
          return matches();
        },
        addEventListener: (_: string, listener: EventListener) => listeners.add(listener),
        removeEventListener: (_: string, listener: EventListener) => listeners.delete(listener),
      } as unknown as MediaQueryList;
    });
  }
  const resize = (width: number) =>
    act(async () => {
      viewport = width;
      listeners.forEach((listener) => listener(new Event('change')));
    });
  const chip = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('.chips button')].find(
      (button) => button.textContent === label,
    )!;
  const rankRows = () => [...host.querySelectorAll<HTMLElement>('#market-rows li')];
  const barWidths = () =>
    [...host.querySelectorAll<HTMLElement>('.rank-bar')].map((bar) => parseFloat(bar.style.width));
  const foreignNet = { AAAA: 5e8, BBCA: -7e8, CCCC: 1e8 };
  const withForeign = () =>
    stubData({
      'tickers.json': Object.entries(foreignNet).map(([ticker, net_foreign]) => ({
        ticker,
        name: `Company ${ticker}`,
        close: 100,
        change_pct: 1,
        volume: 700,
        value: 70000,
        net_foreign,
      })),
    });
  const manyStocks = Array.from({ length: 120 }, (_, i) =>
    marketStock(`S${String(i).padStart(3, '0')}`, 1e9 * (i + 1), i % 2 ? -i / 4 : i / 4),
  );

  it('ranks with sort chips that mirror the headers and turns the foreign chips off after 1D', async () => {
    withForeign();
    window.history.replaceState(null, '', '/market');
    await render();
    const pressed = () =>
      [...host.querySelectorAll('.chips button[aria-pressed="true"]')].map((b) => b.textContent);
    const sortOf = (n: number) =>
      host.querySelector(`th:nth-child(${n})`)?.getAttribute('aria-sort');
    expect(stockOrder('.chips button')).toEqual([
      'Gainers',
      'Losers',
      'Value',
      'Foreign buy',
      'Foreign sell',
    ]);
    expect(pressed()).toEqual(['Value']);
    await act(async () => chip('Gainers').click());
    expect(order()).toEqual(['AAAA', 'BBCA', 'CCCC']);
    expect(sortOf(3)).toBe('descending');
    await act(async () => chip('Losers').click());
    expect(order()).toEqual(['BBCA', 'AAAA', 'CCCC']);
    expect(sortOf(3)).toBe('ascending');
    await act(async () => chip('Foreign buy').click());
    expect(order()).toEqual(['AAAA', 'CCCC', 'BBCA']);
    expect(sortOf(5)).toBe('descending');
    expect(stockOrder('#market-rows td:nth-child(5)')).toEqual(['+500.0M', '+100.0M', '−700.0M']);
    await act(async () => chip('Foreign sell').click());
    expect(order()).toEqual(['BBCA', 'CCCC', 'AAAA']);
    expect(sortOf(5)).toBe('ascending');
    await click('th:nth-child(4) button');
    expect(order()).toEqual(['CCCC', 'BBCA', 'AAAA']);
    expect(pressed()).toEqual(['Value']);
    await act(async () => chip('Foreign sell').click());
    await click('.ranges button:nth-child(2)');
    expect(order()).toEqual(['CCCC', 'BBCA', 'AAAA']);
    expect(pressed()).toEqual(['Value']);
    for (const label of ['Foreign buy', 'Foreign sell']) {
      expect(chip(label).disabled).toBe(true);
      expect(chip(label).title).toBe('Foreign estimates are available for one session only');
    }
    expect(chip('Gainers').disabled).toBe(false);
    expect(stockOrder('th')).not.toContain('Net foreignIDR');
  });

  it('swaps the table for ranked rows on a phone, caps them at 50 and scales bars to the largest visible value', async () => {
    fakeViewport(390);
    withForeign();
    stubData({ 'market-summary.json': { date: summary.date, stocks: manyStocks } });
    window.history.replaceState(null, '', '/market');
    await render();
    expect(host.querySelector('table')).toBeNull();
    expect(rankRows()).toHaveLength(50);
    expect(order()[0]).toBe('S119');
    const widths = barWidths();
    expect(widths[0]).toBe(100);
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
    expect(widths[49]).toBeLessThan(widths[0]!);
    expect(host.querySelector('.rank-bar')?.className.trim()).toBe('rank-bar');
    const more = () =>
      [...host.querySelectorAll('button')].find((b) => /^Show \d+ more$/.test(b.textContent ?? ''));
    expect(more()?.textContent).toBe('Show 50 more');
    await act(async () => more()!.click());
    expect(rankRows()).toHaveLength(100);
    await act(async () => more()!.click());
    expect(rankRows()).toHaveLength(120);
    expect(more()).toBeUndefined();
    await act(async () => chip('Gainers').click());
    expect(rankRows()).toHaveLength(50);
    expect(order()[0]).toBe('S118');
    expect(host.querySelector('.rank-bar')?.classList.contains('up')).toBe(true);
    await act(async () => chip('Losers').click());
    expect(order()[0]).toBe('S119');
    expect(host.querySelector('.rank-bar')?.classList.contains('down')).toBe(true);
    const losing = barWidths();
    expect(losing[0]).toBe(100);
    expect(losing).toEqual([...losing].sort((a, b) => b - a));
    await resize(1200);
    expect(rankRows()).toHaveLength(0);
    expect(host.querySelector('table')).not.toBeNull();
    await resize(390);
    expect(host.querySelector('table')).toBeNull();
  });

  it('draws each signal as a shape in phone rows and keeps the exact text in the title', async () => {
    fakeViewport(390);
    feed = [
      {
        ticker: 'AAAA',
        date: dates[3],
        kind: 'foreign_streak',
        numbers: { streak_days: 20, net_foreign: 156.6e6 },
      },
      {
        ticker: 'BBCA',
        date: dates[3],
        kind: 'foreign_streak',
        numbers: { streak_days: 7, net_foreign: 78.3e6 },
      },
      ownership('CCCC', 'Holder', 6, 9),
    ];
    window.history.replaceState(null, '', '/market?show=foreign_streak');
    await render();
    expect(rankRows().map((row) => row.querySelector('strong')?.textContent)).toEqual([
      'AAAA',
      'BBCA',
    ]);
    const first = rankRows()[0]!;
    expect(first.querySelector('.rank-signal')?.getAttribute('title')).toContain(
      'net foreign +156,600,000 IDR across 20 days',
    );
    expect(first.querySelector('.rank-nums span')?.textContent).toBe('20d +156.6M');
    const widths = [...host.querySelectorAll<HTMLElement>('.rank-signal .rank-bar')].map((bar) =>
      parseFloat(bar.style.width),
    );
    expect(widths).toEqual([100, 50]);
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('.toolbar .tabs button')]
        .find((button) => button.textContent?.startsWith('5%'))!
        .click(),
    );
    const dumbbell = host.querySelector('#market-rows .dumbbell');
    expect(dumbbell?.classList.contains('up')).toBe(true);
    expect(dumbbell?.querySelector('.dumbbell-before')?.getAttribute('cx')).toBe('6%');
    expect(dumbbell?.querySelector('.dumbbell-after')?.getAttribute('cx')).toBe('9%');
    expect(rankRows()[0]?.querySelector('.rank-nums span')?.textContent).toBe('6.00 → 9.00%');
  });

  it('keeps the chosen sort in the address so a shared or revisited link restores it', async () => {
    window.history.replaceState(null, '', '/market?sort=losers');
    await render();
    expect(
      [...host.querySelectorAll('.chips button')]
        .find((b) => b.textContent === 'Losers')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('.chips button')]
        .find((b) => b.textContent === 'Gainers')!
        .click(),
    );
    expect(window.location.search).toBe('?sort=gainers');
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('.chips button')]
        .find((b) => b.textContent === 'Value')!
        .click(),
    );
    expect(window.location.search).toBe('');
  });

  it('flags risky stocks in both the table and the phone rows', async () => {
    fakeViewport(1024);
    window.history.replaceState(null, '', '/market');
    await render();
    const flags = (selector: string) => stockOrder(`${selector} .risk-chip`);
    expect(flags('#market-rows tr:nth-child(1)')).toEqual(['SUSP']);
    expect(flags('#market-rows tr:nth-child(2)')).toEqual([]);
    expect(flags('#market-rows tr:nth-child(3)')).toEqual(['UMA', 'FCA']);
    await resize(390);
    expect(flags('#market-rows li:nth-child(1)')).toEqual(['SUSP']);
    expect(flags('#market-rows li:nth-child(2)')).toEqual([]);
    expect(flags('#market-rows li:nth-child(3)')).toEqual(['UMA', 'FCA']);
  });
});
