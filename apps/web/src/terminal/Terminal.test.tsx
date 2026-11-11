// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { Terminal } from './Terminal';
import { cumulativeFlows, foreignFlow } from './BrokerPanes';
import type { BrokerDay } from '../brokers';
import { tickTradesSchema, type TickTrades } from '../ticks';

const crosshair = vi.hoisted(() => ({ move: (_event: { time?: number }) => {} }));

// jsdom has no canvas, so charts become an object that accepts any call.
vi.mock('./charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./charts')>();
  const chart: object = new Proxy(() => chart, {
    get: (_, key) =>
      key === 'subscribeCrosshairMove'
        ? (listener: typeof crosshair.move) => {
            crosshair.move = listener;
          }
        : key === 'then'
          ? undefined
          : chart,
    apply: () => chart,
  });
  return { ...actual, terminalChart: () => chart };
});
const auth = vi.hoisted(() => ({
  user: null as { id: string } | null,
  isLoading: false,
  getAccessToken: vi.fn<() => Promise<string | undefined>>(async () => 'test'),
  signIn: vi.fn<() => Promise<void>>(async () => {}),
}));
vi.mock('@workos-inc/authkit-react', () => ({ useAuth: () => auth }));
const row = (
  broker: string,
  shares: number,
  value: number,
  investor: 'domestic' | 'foreign' = 'domestic',
) => ({
  broker,
  shares,
  value,
  investor,
  broker_type: 'local' as const,
  avg_price: value / shares,
  freq: 1,
});
const days: BrokerDay[] = [
  {
    date: '2026-11-06',
    board: 'regular',
    buy: [row('AA', 1000, 100000), row('BB', 2000, 400000, 'foreign')],
    sell: [row('AA', 500, 75000), row('CC', 2000, 500000)],
  },
  {
    date: '2026-11-09',
    board: 'regular',
    buy: [row('AA', 500, 50000)],
    sell: [row('BB', 1000, 200000, 'foreign')],
  },
  {
    date: '2026-11-09',
    board: 'negotiation',
    buy: [row('CC', 5000, 500000)],
    sell: [row('AA', 5000, 500000)],
  },
];
let root: Root, host: HTMLDivElement;
let newsAvailable = false;
let tickSessions = false;
let drilldown: TickTrades | null = null;
let dailyOpen: number | null = null;
let sourceFailed = false;
const fetcher = vi.fn<typeof fetch>(async (input) => {
  const path = requestUrl(input);
  if (path.includes('tickers.json'))
    return Response.json(
      ['BREN', 'BBCA'].map((ticker) => ({
        ticker,
        name: `Company ${ticker}`,
        close: 100,
        change_pct: 1,
        volume: 100,
        value: 10000,
        net_foreign: 10,
      })),
    );
  if (path.includes('health.json'))
    return Response.json({
      prices: '2026-11-09',
      indices: '2026-11-09',
      five_pct: null,
      issuers: null,
      run_at: sourceFailed ? new Date().toISOString() : '2026-11-09',
      brokers: '2026-11-06',
      failed: sourceFailed ? ['brokers'] : [],
    });
  if (path.includes('market-summary.json'))
    return Response.json({ date: '2026-11-09', stocks: [] });
  if (path.includes('market.json'))
    return Response.json({ date: '2026-11-09', up: 1, down: 1, history: [] });
  if (path.includes('feed.json')) return Response.json([]);
  if (path.includes('ticker/')) {
    const ticker = path.includes('BBCA') ? 'BBCA' : 'BREN';
    return Response.json({
      ticker,
      name: `Company ${ticker}`,
      prices: tickSessions
        ? (drilldown ? ['2026-06-01', drilldown.date] : ['2026-11-06', '2026-11-09']).map(
            (date) => ({
              date,
              open: dailyOpen,
              close: 7675,
              volume: 100,
              value: 767500,
              net_foreign: 0,
            }),
          )
        : [],
      holders: [],
      changes: [],
    });
  }
  if (path.includes('/api/news'))
    return Response.json([
      {
        title: 'Ticker news from existing API',
        url: 'https://example.com/ticker-news',
        published_at: '2026-11-09T09:00:00Z',
        source: 'Publisher',
      },
    ]);
  if (path.includes('view=ticks')) {
    if (drilldown && path.includes('kind=trades')) return Response.json(drilldown);
    if (!path.includes('date=2026-11-09')) return new Response('', { status: 404 });
    return Response.json(
      path.includes('kind=book')
        ? {
            date: '2026-11-09',
            ticker: 'BREN',
            close: 7675,
            bid: [[7650, 2, 6000]],
            offer: [[7675, 3, 9000]],
          }
        : {
            date: '2026-11-09',
            ticker: 'BREN',
            time: [32729, 32731],
            price: [7650, 7675],
            shares: [145000, 2000],
            side: ['s', 'b'],
            auction: [false, false],
            board: ['RG', 'RG'],
            buyer: ['YP', 'AK'],
            buyer_foreign: [true, true],
            seller: ['XL', 'CC'],
            seller_foreign: [false, false],
            buy_order: [11, 120],
            sell_order: [99, 12],
          },
    );
  }
  if (path.includes('/api/brokers'))
    return Response.json({ ticker: path.includes('BBCA') ? 'BBCA' : 'BREN', days });
  if (path === '/data/news.json' && newsAvailable)
    return Response.json({
      news: [
        {
          ts: '2026-11-09T08:00:00Z',
          src: 'Publisher',
          title: 'Issuer update',
          link: 'https://example.com/original',
          region: 'ID',
          sum: 'The published item summary.',
          tags: ['BREN'],
        },
      ],
    });
  return new Response('', { status: 404 });
});
function button(selector: string) {
  const el = host.querySelector(selector);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`Missing ${selector}`);
  return el;
}
async function click(selector: string) {
  await act(async () => button(selector).click());
}
async function render() {
  await act(async () => root.render(<Terminal />));
}
async function command(text: string) {
  await act(async () => {
    const input = host.querySelector('input[aria-label="Command"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing command input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector('input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
}
beforeEach(() => {
  tickSessions = false;
  drilldown = null;
  sourceFailed = false;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/terminal?t=BREN&l=grid');
  window.localStorage.clear();
  auth.user = null;
  auth.isLoading = false;
  auth.signIn.mockClear();
  fetcher.mockClear();
  newsAvailable = false;
  vi.stubGlobal('fetch', fetcher);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe('React terminal', () => {
  it('opens ticker links, switches layouts and restores maximized panes', async () => {
    window.localStorage.setItem('vibe-idx:watchlist', JSON.stringify(['BBCA']));
    await render();
    const link = host.querySelector<HTMLAnchorElement>('a.ticker');
    expect(link?.getAttribute('href')).toBe('/terminal?t=BBCA&l=focus');
    await act(async () => link?.click());
    expect(window.location.search).toContain('t=BBCA');
    await click('.lay button:nth-child(2)');
    expect(host.querySelectorAll('.pane')).toHaveLength(3);
    expect(window.location.search).toContain('l=focus');
    await click('.pane .maxb');
    expect(host.querySelector('.pane.max')).not.toBeNull();
    await click('.pane.max .maxb');
    expect(host.querySelector('.pane.max')).toBeNull();
    await click('.lay button:nth-child(3)');
    expect(host.querySelectorAll('.pane')).toHaveLength(4);
    expect(host.textContent).not.toContain('SAMPLE');
    expect(host.querySelector('[role="tab"][title="Closing order book"]')).not.toBeNull();
  });
  it.each([
    ['GP', 'FF'],
    ['DD', 'RT'],
    ['TB', 'OB'],
  ])('keeps %s and %s visible together in FLOW', async (first, second) => {
    await render();
    await command('FLOW');
    await click(`[role="tab"][id$="-${first}"]`);
    await click(`[role="tab"][id$="-${second}"]`);
    for (const id of [first, second]) {
      expect(button(`[role="tab"][id$="-${id}"]`).getAttribute('aria-selected')).toBe('true');
      expect(host.querySelector(`[role="tabpanel"][aria-labelledby$="-${id}"]`)).not.toBeNull();
    }
  });
  it('renders missing publications once and resets scrolling on filter changes', async () => {
    await render();
    expect(host.textContent).toContain('News unavailable');
    await command('CAL');
    expect(host.textContent).toContain('Calendar unavailable');
    const body = host.querySelector<HTMLDivElement>('[aria-label="Economic calendar"] .pb');
    if (!body) throw new Error('Missing body');
    body.scrollTop = 120;
    await click('[aria-label="Calendar"] button:nth-child(2)');
    expect(body.scrollTop).toBe(0);
    await command('CA');
    expect(host.textContent).toContain('Corporate actions unavailable');
    await command('RISK');
    expect(host.textContent).toContain('Risk flags unavailable');
    expect(
      fetcher.mock.calls.filter(([path]) => requestUrl(path) === '/data/news.json'),
    ).toHaveLength(1);
    expect(fetcher.mock.calls.every(([path]) => !requestUrl(path).includes('/proto/'))).toBe(true);
  });
  it('reads only the published summary and links the original without article fetching', async () => {
    newsAvailable = true;
    await render();
    await click('.news-item');
    expect(host.querySelector('.reader')?.textContent).toContain('The published item summary.');
    expect(host.querySelector('.reader footer a')?.getAttribute('href')).toBe(
      'https://example.com/original',
    );
    expect(
      fetcher.mock.calls.every(
        ([path]) =>
          !requestUrl(path).includes('article') && !requestUrl(path).includes('example.com'),
      ),
    ).toBe(true);
  });
  it('supports ticker commands and preserves the sign-in return query', async () => {
    await render();
    await command('BBCA BRK');
    expect(window.location.search).toBe('?t=BBCA&l=grid');
    await click('[role="tabpanel"][aria-labelledby$="-BRK"] .empty button');
    expect(auth.signIn).toHaveBeenCalledOnce();
    expect(window.sessionStorage.getItem('vibe-idx-return-to')).toBe('/terminal?t=BBCA&l=grid');
    expect(fetcher.mock.calls.every(([path]) => !requestUrl(path).includes('/api/brokers'))).toBe(
      true,
    );
  });
  it.each(['BRK', 'BFL', 'FF', 'OB', 'RT', 'DD', 'TB'])(
    'hides %s filters while signed out',
    async (pane) => {
      await render();
      await command(`FOCUS BREN ${pane}`);
      expect(host.querySelector('.broker-controls')).toBeNull();
      expect(host.textContent).toContain('Sign in to see broker and trade data');
      expect(fetcher.mock.calls.every(([path]) => !requestUrl(path).includes('/api/brokers'))).toBe(
        true,
      );
    },
  );
  it('runs layout and ticker commands together and reads ticker news through the existing API', async () => {
    await render();
    await command('FOCUS BBCA NEWS');
    expect(window.location.search).toBe('?t=BBCA&l=focus');
    expect(host.querySelectorAll('.pane')).toHaveLength(3);
    expect(
      host.querySelector('[aria-label="News region"] button[aria-pressed="true"]')?.textContent,
    ).toBe('TICKER');
    expect(host.textContent).toContain('Ticker news from existing API');
    await click('.news-item');
    expect(host.querySelector('.reader')?.textContent).toContain('Summary unavailable');
  });
  it('filters broker boards, types and units, pairs gross rows and mutes edge prices', async () => {
    auth.user = { id: 'test-user' };
    await render();
    await command('BRK');
    expect(host.querySelector('.broker-ledger.buy')?.textContent).toContain('50.0K');
    await click('[aria-label="Broker period"] button:nth-child(2)');
    expect(host.querySelector('.broker-ledger.buy')?.textContent).toContain('200.0K');
    await click('[aria-label="Broker mode"] button:nth-child(2)');
    await click('.broker-ledger.buy button');
    expect(host.querySelectorAll('.broker-ledger tr.dim').length).toBeGreaterThan(0);
    expect(host.querySelector('.broker-ledger .edge')).not.toBeNull();
    await click('[aria-label="Client domicile"] button:nth-child(2)');
    expect(host.querySelector('.broker-ledger.buy')?.textContent).toContain('BB');
    expect(host.querySelector('.broker-ledger.buy')?.textContent).not.toContain('AA');
    await click('[aria-label="Broker unit"] button:nth-child(2)');
    expect(host.querySelector('.broker-ledger.buy td.bar')?.textContent).toBe('20');
    await click('[aria-label="Client domicile"] button:nth-child(3)');
    expect(host.querySelector('.broker-ledger.buy')?.textContent).toContain('AA');
    expect(host.querySelector('.broker-ledger.buy')?.textContent).not.toContain('BB');
    await click('[aria-label="Market board"] button:nth-child(3)');
    expect(host.textContent).toContain('No trades');
  });
  it('renders NET broker codes as text and keeps GROSS pairing interactive', async () => {
    auth.user = { id: 'test-user' };
    await render();
    await command('BRK');
    expect(host.querySelector('.broker-ledger button')).toBeNull();
    expect(host.querySelector('.broker-ledger td.l span')?.getAttribute('title')).toContain(
      'LOCAL',
    );
    await click('[aria-label="Broker mode"] button:nth-child(2)');
    await click('.broker-ledger.buy button');
    expect(host.querySelector('.broker-ledger button[aria-pressed="true"]')).not.toBeNull();
  });
  it('shows broker dates and warns about older data above BRK, BFL and FF content', async () => {
    const serve = fetcher.getMockImplementation();
    if (!serve) throw new Error('Missing fixture fetcher');
    auth.user = { id: 'test-user' };
    await fetcher.withImplementation(
      async (input, init) => {
        const response = await serve(input, init);
        if (!requestUrl(input).includes('health.json')) return response;
        return Response.json({ ...(await response.json()), prices: '2026-11-10' });
      },
      async () => {
        await render();
        await command('BRK');
        await click('[aria-label="Broker period"] button:nth-child(2)');
        expect(host.querySelector('.broker-date')?.textContent).toContain('6–9 Nov 2026');
        for (const pane of ['BRK', 'BFL', 'FF']) {
          await command(`FOCUS BREN ${pane}`);
          const date = host.querySelector('.broker-date');
          expect(date?.getAttribute('role')).toBe('status');
          expect(date?.textContent).toContain('Behind prices');
          expect(date?.nextElementSibling?.className).toMatch(/pb|flow-view/);
        }
      },
    );
  });
  it('counts market sessions for 20D and shows No trades for a thin board with no recent trades', async () => {
    const serve = fetcher.getMockImplementation();
    if (!serve) throw new Error('Missing fixture fetcher');
    auth.user = { id: 'test-user' };
    const history = Array.from({ length: 40 }, (_, i) => {
      const date = new Date('2026-11-09T00:00:00Z');
      date.setUTCDate(date.getUTCDate() - i);
      return date;
    })
      .filter((date) => date.getUTCDay() !== 0 && date.getUTCDay() !== 6)
      .map((date) => ({
        date: date.toISOString().slice(0, 10),
        close: 100,
        change: 0,
        change_pct: 0,
      }));
    await fetcher.withImplementation(
      async (input, init) => {
        const path = requestUrl(input);
        if (path.includes('market.json'))
          return Response.json({ date: '2026-11-09', up: 0, down: 0, history });
        if (path.includes('/api/brokers'))
          return Response.json({
            ticker: 'BREN',
            days: [
              { ...days[0], date: '2026-09-01' },
              { ...days[0], date: '2026-09-01', board: 'cash' },
              { ...days[1], date: '2026-09-02' },
              { ...days[1], date: '2026-11-09' },
            ],
          });
        return serve(input, init);
      },
      async () => {
        await render();
        await command('BRK');
        await click('[aria-label="Broker period"] button:nth-child(3)');
        expect(host.querySelector('.broker-ledger.buy')?.textContent).toContain('50.0K');
        expect(host.querySelector('.broker-ledger.buy')?.textContent).not.toContain('200.0K');
        await click('[aria-label="Market board"] button:nth-child(3)');
        expect(host.textContent).toContain('No trades');
        expect(host.querySelector('.broker-ledger')).toBeNull();
      },
    );
  });
  it.each(['LOCAL', 'GOV'])(
    'falls back to ALL with obsolete stored %s broker preferences',
    async (type) => {
      window.localStorage.setItem('vibe-idx:broker', JSON.stringify({ type }));
      window.history.replaceState(null, '', `/terminal?t=BREN&l=grid&brokerType=${type}`);
      auth.user = { id: 'test-user' };
      await render();
      await command('BRK');
      expect(
        host.querySelector('[aria-label="Client domicile"] button[aria-pressed="true"]')
          ?.textContent,
      ).toBe('ALL');
    },
  );
  it('pins the current ticker in the empty watchlist and can unpin it', async () => {
    await render();
    expect(host.querySelector('[data-slot="a"] a[href="/"]')).toBeNull();
    await click('[data-slot="a"] [aria-label="Pin BREN"]');
    expect(JSON.parse(window.localStorage.getItem('vibe-idx:watchlist') ?? '[]')).toEqual(['BREN']);
    expect(host.querySelector('[data-slot="a"] a.ticker')?.textContent).toBe('BREN');
    await click('[data-slot="a"] [aria-label="Unpin BREN"]');
    expect(JSON.parse(window.localStorage.getItem('vibe-idx:watchlist') ?? '[]')).toEqual([]);
    expect(host.querySelector('[data-slot="a"] a.ticker')).toBeNull();
  });
  it('uses the entire mover row to select a ticker and keeps links and pin controls independent', async () => {
    await render();
    await command('MOV');
    await click('[aria-label="Movers"] button:nth-child(4)');
    await click('[data-slot="c"] [aria-label="Pin BBCA"]');
    expect(window.location.search).toContain('t=BREN');
    expect(host.querySelector('[data-slot="a"] a.ticker')?.textContent).toBe('BBCA');
    await act(async () => {
      host
        .querySelector('[data-slot="c"] tbody tr:nth-child(2) td:last-child')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(window.location.search).toContain('t=BBCA');
    const link = host.querySelector('[data-slot="c"] tbody tr:nth-child(2) a.ticker');
    const modifiedClick = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    await act(async () => link?.dispatchEvent(modifiedClick));
    expect(modifiedClick.defaultPrevented).toBe(false);
  });
  it('limits foreign movers to one session and restores longer periods for price movers', async () => {
    await render();
    await command('MOV');
    await click('[aria-label="Mover period"] button:nth-child(2)');
    await click('[aria-label="Movers"] button:nth-child(4)');
    expect(
      button('[aria-label="Mover period"] button:nth-child(1)').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(button('[aria-label="Mover period"] button:nth-child(2)').disabled).toBe(true);
    expect(button('[aria-label="Mover period"] button:nth-child(3)').disabled).toBe(true);
    expect(host.textContent).not.toContain('Foreign flow is available for 1D only.');
    await click('[aria-label="Movers"] button:nth-child(1)');
    expect(button('[aria-label="Mover period"] button:nth-child(2)').disabled).toBe(false);
  });
  it('keeps broker flow colours stable across pins and closes the picker on Escape', async () => {
    auth.user = { id: 'test-user' };
    await render();
    await command('FOCUS BREN BFL');
    const colours = () =>
      new Map(
        [...host.querySelectorAll<HTMLElement>('.broker-key')].map((key) => [
          key.textContent?.slice(0, 2),
          key.querySelector('i')?.style.background,
        ]),
      );
    const before = colours();
    await click('[aria-label="Add broker"]');
    await act(async () =>
      host
        .querySelector('input[aria-label="Find a broker"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(host.querySelector('.broker-picker')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Add broker');
    await click('[aria-label="Add broker"]');
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('.broker-picker > button')]
        .find((button) => button.textContent?.startsWith('CC '))
        ?.click(),
    );
    expect(host.querySelector('[aria-label="Remove CC"]')).not.toBeNull();
    expect(colours()).toEqual(before);
    for (const colour of colours().values())
      expect(colour).not.toMatch(/34, 166, 160|214, 178, 94|228, 87, 63/);
  });
  it('builds cumulative net flows from actual dates and selected broker types', () => {
    const regular = days.filter((day) => day.board === 'regular');
    const flow = cumulativeFlows(regular, ['2026-11-06', '2026-11-09'], 'VALUE', 'ALL');
    expect(flow.find((series) => series.code === 'AA')?.points.map((p) => p.value)).toEqual([
      25000, 75000,
    ]);
    expect(flow.find((series) => series.code === 'BB')?.points.map((p) => p.value)).toEqual([
      400000, 200000,
    ]);
    expect(
      cumulativeFlows(regular, ['2026-11-06', '2026-11-09'], 'VALUE', 'DOMESTIC').map(
        (series) => series.code,
      ),
    ).toEqual(['AA', 'CC']);
    expect(cumulativeFlows(regular, ['2026-11-06', '2026-11-09'], 'LOT', 'FOREIGN')).toEqual([
      {
        code: 'BB',
        points: [
          { time: '2026-11-06', value: 20 },
          { time: '2026-11-09', value: 10 },
        ],
      },
    ]);
  });
  it('nets foreign client buying per day with a running total and foreign share of gross value', () => {
    const regular = days.filter((day) => day.board === 'regular');
    const dates = ['2026-11-06', '2026-11-09'];
    expect(foreignFlow(regular, dates, 'VALUE')).toEqual([
      { date: '2026-11-06', net: 400000, cumulative: 400000, share: 400000 / 1075000 },
      { date: '2026-11-09', net: -200000, cumulative: 200000, share: 0.8 },
    ]);
    expect(foreignFlow(regular, dates, 'LOT').map((d) => [d.net, d.cumulative])).toEqual([
      [20, 20],
      [-10, 10],
    ]);
    expect(foreignFlow([], ['2026-11-06'], 'VALUE')).toEqual([
      { date: '2026-11-06', net: 0, cumulative: 0, share: null },
    ]);
  });
  it('shows intraday OHLC and volume, inspects a bar on hover, and restores the latest bar on leave', async () => {
    const serve = fetcher.getMockImplementation();
    if (!serve) throw new Error('Missing fixture fetcher');
    auth.user = { id: 'test-user' };
    const trades = {
      date: '2026-11-10',
      ticker: 'BBCA',
      time: [32700, 43200, 58200],
      price: [100, 120, 90],
      shares: [100, 200, 300],
      side: ['b', 'b', 's'],
      auction: [false, false, true],
      board: ['RG', 'RG', 'RG'],
      buyer: ['AA', 'AA', 'BB'],
      buyer_foreign: [false, false, true],
      seller: ['CC', 'CC', 'AA'],
      seller_foreign: [true, false, false],
      buy_order: [1, 2, 3],
      sell_order: [4, 5, 6],
    };
    await fetcher.withImplementation(
      async (input, init) => {
        const path = requestUrl(input);
        if (path.includes('ticker/BBCA'))
          return Response.json({
            ticker: 'BBCA',
            name: 'BBCA',
            prices: [{ date: '2026-11-10', close: 90, volume: 600, value: 61000, net_foreign: 0 }],
            holders: [],
            changes: [],
          });
        if (path.includes('view=ticks') && path.includes('ticker=BBCA'))
          return Response.json(trades);
        return serve(input, init);
      },
      async () => {
        await render();
        await command('FOCUS BBCA GP');
        await click('[aria-label="Chart timeframe"] button:nth-child(4)');
        const header = () => host.querySelector('.price-view .legend');
        expect(header()?.textContent).toContain('16:00 WIBO 90H 90L 90C 90 IDRLOT 3');
        const midnight = Date.parse('2026-11-10T00:00:00+07:00') / 1000;
        await act(async () => crosshair.move({ time: midnight + 43200 }));
        expect(header()?.textContent).toContain('12:00 WIBO 120H 120L 120C 120 IDRLOT 2');
        await act(async () =>
          host
            .querySelector('.price-chart-wrap')
            ?.dispatchEvent(new Event('pointerout', { bubbles: true })),
        );
        expect(header()?.textContent).toContain('16:00 WIBO 90H 90L 90C 90 IDRLOT 3');
      },
    );
  });
  it('draws order-book depth only on populated levels', async () => {
    const serve = fetcher.getMockImplementation();
    if (!serve) throw new Error('Missing fixture fetcher');
    auth.user = { id: 'test-user' };
    await fetcher.withImplementation(
      async (input, init) => {
        const path = requestUrl(input);
        if (path.includes('ticker/BBCA'))
          return Response.json({
            ticker: 'BBCA',
            name: 'BBCA',
            prices: [{ date: '2026-11-10', close: 90, volume: 600, value: 61000, net_foreign: 0 }],
            holders: [],
            changes: [],
          });
        if (path.includes('view=ticks') && path.includes('kind=book'))
          return Response.json({
            date: '2026-11-10',
            ticker: 'BBCA',
            close: 100,
            bid: [[99, 1, 100]],
            offer: [
              [100, 1, 200],
              [101, 2, 300],
              [102, 3, 400],
            ],
          });
        return serve(input, init);
      },
      async () => {
        await render();
        await command('FOCUS BBCA OB');
        expect(host.querySelectorAll('.tick-book .depth.bid')).toHaveLength(1);
        expect(host.querySelectorAll('.tick-book .depth.offer')).toHaveLength(3);
        expect(
          [...host.querySelectorAll('.tick-book td.depth')].every((cell) => cell.textContent),
        ).toBe(true);
      },
    );
  });
  it('shows the closing book for the latest session, steps back, and filters running trades by broker', async () => {
    tickSessions = true;
    auth.user = { id: 'test-user' };
    await render();
    await command('BREN OB');
    expect(host.querySelector('.tick-session time')?.textContent).toBe('9 Nov 2026');
    expect(host.querySelector('.tick-book tbody td.up')?.textContent).toBe('7,650');
    expect(host.querySelector('.tick-book tbody td.depth.offer')?.textContent).toBe('90');
    await click('[aria-label="Previous session"]');
    expect(host.textContent).toContain('Not collected for 6 Nov 2026');
    await click('[aria-label="Next session"]');
    await command('BREN RT');
    expect(host.querySelectorAll('.tick-table:not(.tick-book) tbody tr')).toHaveLength(2);
    await act(async () => {
      const input = host.querySelector('input[aria-label="Filter by broker"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('Missing broker filter');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'xl');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const rows = host.querySelectorAll('.tick-table:not(.tick-book) tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('1,450');
    expect(rows[0]?.querySelector('.tick-foreign')?.textContent).toBe('YP F');
  });
});

function requestUrl(input: RequestInfo | URL) {
  return input instanceof Request ? input.url : input.toString();
}

it('pushes ticker navigation, replaces layout navigation and restores on popstate', async () => {
  const push = vi.spyOn(window.history, 'pushState');
  const replace = vi.spyOn(window.history, 'replaceState');
  await render();
  expect(push).not.toHaveBeenCalled();
  await command('BBCA');
  expect(push).toHaveBeenCalledOnce();
  await command('FOCUS');
  expect(push).toHaveBeenCalledOnce();
  expect(replace).toHaveBeenCalled();
  await act(async () => {
    window.history.replaceState(null, '', '/terminal?t=BREN&l=grid');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(host.querySelector('[aria-label="Pin BREN"]')).not.toBeNull();
  expect(host.querySelectorAll('.pane')).toHaveLength(3);
  expect(push).toHaveBeenCalledOnce();
  push.mockRestore();
  replace.mockRestore();
});

it('restores the layout when a command targets a different maximized pane', async () => {
  await render();
  await click('[data-slot="b"] .maxb');
  await command('SIG');
  expect(host.querySelector('.pane.max')).toBeNull();
  expect(host.querySelector('[data-slot="c"] [aria-selected="true"]')?.textContent).toBe('SIG');
});

it('shows the company name beside the GP ticker and keeps other pane headers compact', async () => {
  await render();
  await command('FOCUS');
  const contexts = [...host.querySelectorAll('.ctx')].filter((el) => el.querySelector('b'));
  expect(contexts).toHaveLength(3);
  expect(contexts.map((el) => el.textContent)).toEqual(['BRENCompany BREN', 'BREN', 'BREN']);
  expect(host.querySelector('.company-name')?.getAttribute('title')).toBe('Company BREN');
  await command('BBCA');
  expect(host.querySelector('.company-name')?.textContent).toBe('Company BBCA');
});

it.each(['GRID', 'FOCUS', 'FLOW'])('opens KEY only from the command bar in %s', async (mode) => {
  await render();
  await command(mode);
  expect(host.querySelector('[role="tab"][title="Key figures"]')).toBeNull();
  await command('KEY');
  expect(
    host.querySelector('[role="tab"][title="Key figures"]')?.getAttribute('aria-selected'),
  ).toBe('true');
  expect(host.querySelector('.description h1')?.textContent).toBe('Company BREN');
  expect(host.querySelector('.description [aria-label="Pin BREN"]')).not.toBeNull();
});

it('uses one tab stop per pane tablist and segment group with arrow navigation', async () => {
  await render();
  for (const list of host.querySelectorAll('.tabs, .seg')) {
    expect([...list.querySelectorAll('button')].filter((el) => el.tabIndex === 0)).toHaveLength(1);
  }
  const tab = button('[data-slot="b"] [aria-selected="true"]');
  await act(async () => {
    tab.focus();
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  expect(document.activeElement?.textContent).toBe('CA');
  const panel = host.querySelector('[data-slot="b"] [role="tabpanel"]');
  expect(document.activeElement?.getAttribute('aria-controls')).toBe(panel?.id);
  expect(panel?.getAttribute('aria-labelledby')).toBe(document.activeElement?.id);
  await command('MOV');
  const segment = button('[aria-label="Movers"] button');
  await act(async () => {
    segment.focus();
    segment.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  });
  expect(document.activeElement?.getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement?.textContent).toBe('F SELL');
});

it('traps keyboard focus in help and restores focus on Escape', async () => {
  await render();
  await click('[aria-label="Keyboard reference"]');
  const dialog = host.querySelector('[role="dialog"]');
  const close = button('[aria-label="Close keyboard reference"]');
  const last = dialog?.querySelector('a:last-child');
  await act(async () => {
    close.focus();
    close.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
  });
  expect(document.activeElement).toBe(last);
  await act(async () =>
    last?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })),
  );
  expect(document.activeElement).toBe(close);
  await act(async () =>
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(button('[aria-label="Keyboard reference"]'));
});

it('shows stale source warnings in the status bar', async () => {
  await render();
  expect(host.querySelector('.status .stale')?.textContent).toContain('Not updated since');
});

it('identifies failed broker sources even when the publication run is fresh', async () => {
  sourceFailed = true;
  await render();
  expect(host.querySelector('.status .stale')?.textContent).toBe(
    'Broker flow not updated since 6 Nov 2026',
  );
});

it('keeps sign-in hidden while AuthKit is loading with no user', async () => {
  auth.isLoading = true;
  await render();
  await command('BRK');
  expect(host.textContent).toContain('Checking sign-in…');
  expect([...host.querySelectorAll('button')].some((el) => el.textContent === 'Sign in')).toBe(
    false,
  );
});

it.each(['4H', '1H', '15M'])(
  'keeps daily and weekly public and gates %s without requesting ticks',
  async (timeframe) => {
    tickSessions = true;
    await render();
    await command('GP');
    expect(host.querySelector('.chart-host')?.getAttribute('data-series')).toBe('candles');
    expect(
      host.querySelector('[aria-label="Chart timeframe"] [aria-pressed="true"]')?.textContent,
    ).toBe('D');
    await click('[aria-label="Chart timeframe"] button:first-child');
    expect(host.querySelector('.chart-host')?.getAttribute('data-bars')).toBe('2');
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Chart timeframe"] button')]
        .find((el) => el.textContent === timeframe)
        ?.click(),
    );
    expect(host.querySelector('[data-slot="b"]')?.textContent).toContain(
      'Sign in to see broker and trade data',
    );
    expect(host.querySelector('.chart-host')).toBeNull();
    expect(fetcher.mock.calls.every(([path]) => !requestUrl(path).includes('view=ticks'))).toBe(
      true,
    );
    expect(host.querySelector('[role="tab"][title="Intraday chart"]')).toBeNull();
    await click('[aria-label="Chart timeframe"] button:nth-child(2)');
    expect(host.querySelector('.chart-host')?.getAttribute('data-bars')).toBe('2');
  },
);

it('keeps two compact control groups, fixed volume and foreign data, and remembers the icon choice', async () => {
  tickSessions = true;
  await render();
  await command('GP');
  const series = () => host.querySelector('.chart-host');
  expect(series()?.getAttribute('data-series')).toBe('candles');
  expect(host.querySelectorAll('.chart-controls [role="group"]')).toHaveLength(2);
  const candle = button('[aria-label="Candlestick"]');
  expect(candle.querySelector('svg')).not.toBeNull();
  expect(candle.textContent).toBe('');
  candle.focus();
  await act(async () =>
    candle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
  );
  expect(document.activeElement).toBe(button('[aria-label="Line"]'));
  expect(button('[aria-label="Line"]').getAttribute('aria-pressed')).toBe('true');
  expect(candle.tabIndex).toBe(-1);
  await click('[aria-label="Chart timeframe"] button:first-child');
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  await command('GP');
  expect(series()?.getAttribute('data-series')).toBe('line');
  expect(window.localStorage.getItem('terminal:chart:type')).toBe('LINE');
  expect(host.querySelector('.legend')?.textContent).toContain('LOT');
  expect(host.querySelector('.legend')?.textContent).not.toContain('F NET');
  expect(
    host.querySelector('[aria-label="Chart timeframe"] [aria-pressed="true"]')?.textContent,
  ).toBe('D');
});

it('ignores invalid chart type preferences and still works when localStorage is blocked', async () => {
  tickSessions = true;
  window.localStorage.setItem('terminal:chart:type', 'area');
  await render();
  await command('GP');
  expect(host.querySelector('.chart-host')?.getAttribute('data-series')).toBe('candles');
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  try {
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    await command('GP');
    await click('[aria-label="Line"]');
    expect(host.querySelector('.chart-host')?.getAttribute('data-series')).toBe('line');
  } finally {
    get.mockRestore();
    set.mockRestore();
  }
});

it.each([
  { timeframe: '15M', count: 5, month: '03' },
  { timeframe: '1H', count: 10, month: '04' },
  { timeframe: '4H', count: 20, month: '05' },
])(
  'loads an initial $count sessions for $timeframe, skips 404s, and shares the trade cache',
  async ({ timeframe, count, month }) => {
    const serve = fetcher.getMockImplementation();
    if (!serve) throw new Error('Missing fixture fetcher');
    auth.user = { id: 'test-user' };
    const dates = Array.from(
      { length: 25 },
      (_, i) => `2026-${month}-${String(i + 1).padStart(2, '0')}`,
    );
    const latest = dates.at(-1);
    const previous = dates.at(-2);
    await fetcher.withImplementation(
      async (input, init) => {
        const path = requestUrl(input);
        if (path.includes('ticker/BBCA'))
          return Response.json({
            ticker: 'BBCA',
            name: 'BBCA',
            holders: [],
            changes: [],
            prices: dates.map((date) => ({
              date,
              close: 100,
              volume: 100,
              value: 10000,
              net_foreign: 0,
            })),
          });
        if (path.includes('view=ticks') && path.includes('ticker=BBCA')) {
          const date = new URL(path, 'http://localhost').searchParams.get('date');
          if (date !== latest && date !== previous) return new Response('', { status: 404 });
          return Response.json({
            date,
            ticker: 'BBCA',
            time: [32700],
            price: [100],
            shares: [100],
            side: ['b'],
            auction: [false],
            board: ['RG'],
            buyer: ['AA'],
            seller: ['BB'],
            buyer_foreign: [true],
            seller_foreign: [false],
            buy_order: [1],
            sell_order: [2],
          });
        }
        return serve(input, init);
      },
      async () => {
        await render();
        await command('FOCUS BBCA GP');
        await act(async () =>
          [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Chart timeframe"] button')]
            .find((el) => el.textContent === timeframe)
            ?.click(),
        );
        const requests = () =>
          fetcher.mock.calls
            .map(([input]) => requestUrl(input))
            .filter((path) => path.includes('view=ticks') && path.includes('ticker=BBCA'));
        expect(requests()).toHaveLength(count);
        expect(
          requests().map((path) => new URL(path, 'http://localhost').searchParams.get('date')),
        ).toEqual(dates.slice(-count));
        expect(host.querySelector('.chart-host')?.getAttribute('data-bars')).toBe('2');
        await command('RT');
        expect(requests()).toHaveLength(count);
        expect(host.querySelectorAll('.tick-table tbody tr')).toHaveLength(1);
      },
    );
  },
);

let drilldownSession = 0;
function blockSession() {
  const trade = (
    buy: number,
    sell: number,
    buyer: string,
    seller: string,
    shares = 100,
    auction = false,
    board = 'RG',
    foreign = false,
  ) => ({
    time: auction ? 57600 : 32400,
    price: 100,
    shares,
    side: 's',
    auction,
    board,
    buyer,
    seller,
    buyer_foreign: foreign,
    seller_foreign: false,
    buy_order: buy,
    sell_order: sell,
  });
  const rows = [
    trade(1, 99, 'AA', 'XL', 10000, false, 'RG', true),
    trade(2, 99, 'BB', 'XL', 20000),
    trade(5, 99, 'AA', 'XL', 5000, false, 'RG', true),
    { ...trade(120, 121, 'CC', 'DD', 5000), side: 'b' },
    trade(3, 505, 'AA', 'KK', 100),
    trade(4, 505, 'AA', 'KK', 100, false, 'RG', true),
    ...Array.from({ length: 510 }, (_, i) => ({
      ...trade(1000 + i, 2000 + i, 'EE', 'FF'),
      time: 36000 + i,
    })),
    trade(700, 99, 'PA', 'XL', 400, true),
    trade(701, 8800, 'ZZ', 'YY', 100, true),
    trade(702, 99, 'QB', 'XL', 500, true),
    trade(99, 8801, 'XX', 'YY', 100, true),
    trade(703, 99, 'RC', 'XL', 600, true),
    trade(704, 99, 'NG', 'XL', 100, true, 'NG'),
  ];
  const columns = {
    time: rows.map((r) => r.time),
    price: rows.map((r) => r.price),
    shares: rows.map((r) => r.shares),
    side: rows.map((r) => r.side),
    auction: rows.map((r) => r.auction),
    board: rows.map((r) => r.board),
    buyer: rows.map((r) => r.buyer),
    seller: rows.map((r) => r.seller),
    buyer_foreign: rows.map((r) => r.buyer_foreign),
    seller_foreign: rows.map((r) => r.seller_foreign),
    buy_order: rows.map((r) => r.buy_order),
    sell_order: rows.map((r) => r.sell_order),
  };
  return tickTradesSchema.parse({
    ticker: 'BREN',
    date: `2026-07-${String(++drilldownSession).padStart(2, '0')}`,
    ...columns,
  });
}
function prepareBlocks() {
  dailyOpen = null;
  tickSessions = true;
  auth.user = { id: 'test-user' };
  drilldown = blockSession();
}
const highlightedFills = () => [...host.querySelectorAll('.tick-tape [data-highlighted="true"]')];

const sharedTradeColumns = ['Time', 'Price', 'Action', 'Lot', 'Val', 'Buy', 'Sell', 'Market'];
const cells = (row: Element) => [...row.querySelectorAll('td')].map((cell) => cell.textContent);
async function clickBlock(index = 1) {
  await act(async () =>
    host.querySelector<HTMLElement>(`.tick-blocks tbody tr:nth-child(${index})`)?.click(),
  );
}

it.each(['grid', 'focus', 'flow'])(
  'selects a whole order row and opens the existing RT tab in %s with its morning fills',
  async (mode) => {
    prepareBlocks();
    await render();
    await command(`${mode.toUpperCase()} RT`);
    await command('DD');
    const first = host.querySelector('.tick-blocks tbody tr')!;
    expect([...host.querySelectorAll('.tick-blocks th')].map((th) => th.textContent)).toEqual(
      sharedTradeColumns,
    );
    expect(first.querySelectorAll('button')).toHaveLength(1);
    expect(first.querySelector('button')?.tabIndex).toBe(0);
    expect(cells(first)).toEqual([
      '09:00:00',
      '100.0 (0.00%)',
      'SELL',
      '350',
      '3.5M',
      '2',
      'XL D',
      'RG',
    ]);
    expect(first.querySelector('.tick-stack')?.getAttribute('aria-label')).toBe('2 brokers');
    expect(first.querySelector('td')?.classList.contains('mut')).toBe(true);
    expect(first.querySelector('td:nth-child(2) span')?.getAttribute('title')).toBe(
      'First RG continuous trade 100',
    );
    await clickBlock();
    expect(window.location.search).toContain(`l=${mode}`);
    expect(button('[role="tab"][id$="-RT"]').getAttribute('aria-selected')).toBe('true');
    expect([...host.querySelectorAll('.tick-tape th')].map((th) => th.textContent)).toEqual(
      sharedTradeColumns,
    );
    expect(highlightedFills().map(cells)).toEqual([
      ['09:00:00', '100 (0.00%)', 'SELL', '50', '500.0K', 'AA F', 'XL D', 'RG'],
      ['09:00:00', '100 (0.00%)', 'SELL', '200', '2.0M', 'BB D', 'XL D', 'RG'],
      ['09:00:00', '100 (0.00%)', 'SELL', '100', '1.0M', 'AA F', 'XL D', 'RG'],
    ]);
    expect(highlightedFills()[2]?.querySelector('.tick-foreign')?.textContent).toBe('AA F');
    expect(host.querySelectorAll('.tick-tape tbody tr').length).toBeGreaterThan(500);
    expect(host.querySelector('.tick-tape tbody tr:not([data-highlighted])')).not.toBeNull();
    const summary = host.querySelector('.tick-summary')!;
    expect(summary.querySelector('.tick-summary-main')?.textContent).toBe(
      'XL DSELL350 lot100 (0.00%)',
    );
    expect(
      [...summary.querySelectorAll('.tick-counterparties:not([aria-hidden]) > span')].map(
        (party) => party.textContent,
      ),
    ).toEqual(['BB D 200', 'AA F 150']);
    expect(host.textContent).not.toContain('Clear block');
    expect(host.textContent).not.toContain('Aggressor');
    await command('DD');
    expect(host.querySelectorAll('.tick-blocks [aria-pressed="true"]')).toHaveLength(1);
    await clickBlock();
    expect(highlightedFills()).toHaveLength(0);
    expect(host.querySelector('.tick-summary')).toBeNull();
    expect(host.querySelector('.tick-blocks [aria-pressed="true"]')).toBeNull();
  },
);

it('shows BUY, preserves selection across modes, and clears on Escape, date or ticker', async () => {
  prepareBlocks();
  await render();
  await command('DD');
  expect(
    host.querySelector('.tick-blocks tbody tr:nth-child(2) td:nth-child(3)')?.textContent,
  ).toBe('BUY');
  await click('.tick-blocks tbody tr:nth-child(2) button');
  expect(window.location.search).toContain('l=flow');
  expect(highlightedFills().map(cells)).toEqual([
    ['09:00:00', '100 (0.00%)', 'BUY', '50', '500.0K', 'CC D', 'DD D', 'RG'],
  ]);
  await command('FOCUS');
  await command('FLOW');
  expect(highlightedFills()).toHaveLength(1);
  expect(host.querySelectorAll('.tick-blocks [aria-pressed="true"]')).toHaveLength(1);
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(highlightedFills()).toHaveLength(0);
  expect(button('[role="tab"][id$="-RT"]').getAttribute('aria-selected')).toBe('true');
  expect(host.querySelectorAll('.tick-tape tbody tr').length).toBeGreaterThan(500);
  expect(host.querySelector('.tick-summary')).toBeNull();
  await clickBlock();
  await click('[aria-label="Running trade"] [aria-label="Previous session"]');
  expect(host.querySelector('.tick-blocks [aria-pressed="true"]')).toBeNull();
  expect(host.querySelector('.tick-summary')).toBeNull();
  await click('[aria-label="Running trade"] [aria-label="Next session"]');
  await clickBlock();
  expect(highlightedFills()).toHaveLength(3);
  await command('BBCA');
  expect(highlightedFills()).toHaveLength(0);
  await command('BREN');
  expect(host.querySelector('.tick-blocks [aria-pressed="true"]')).toBeNull();
});

it('shows AUC and groups interleaved auction counterparties by lots without matching other orders or boards', async () => {
  prepareBlocks();
  await render();
  await command('FLOW');
  const auction = host.querySelector('.tick-blocks tbody tr:nth-child(3)')!;
  expect(cells(auction)).toEqual([
    '16:00:00',
    '100.0 (0.00%)',
    'AUC',
    '15',
    '150.0K',
    '3',
    'XL D',
    'RG',
  ]);
  await clickBlock(3);
  expect(highlightedFills().map(cells)).toEqual([
    ['16:00:00', '100 (0.00%)', 'AUC', '6', '60.0K', 'RC D', 'XL D', 'RG'],
    ['16:00:00', '100 (0.00%)', 'AUC', '5', '50.0K', 'QB D', 'XL D', 'RG'],
    ['16:00:00', '100 (0.00%)', 'AUC', '4', '40.0K', 'PA D', 'XL D', 'RG'],
  ]);
  expect(host.querySelector('.tick-summary-main')?.textContent).toBe('XL DAUC15 lot100 (0.00%)');
  expect(
    [...host.querySelectorAll('.tick-summary .tick-counterparties:not([aria-hidden]) > span')].map(
      (party) => party.textContent,
    ),
  ).toEqual(['RC D 6', 'QB D 5', 'PA D 4']);
  const tape = [...host.querySelectorAll('.tick-tape tbody tr')];
  expect(tape.slice(1, 6).map((row) => row.hasAttribute('data-highlighted'))).toEqual([
    true,
    false,
    true,
    false,
    true,
  ]);
});

it('counts a broker once when its fills include domestic and foreign clients', async () => {
  prepareBlocks();
  await render();
  await command('DD');
  const order = [...host.querySelectorAll('.tick-blocks tbody tr')].find(
    (row) => row.querySelector('.tick-sell')?.textContent === 'KK D',
  );
  expect(order?.querySelector('.tick-buy')?.textContent).toBe('AA F');
  expect(order?.querySelector('.tick-stack')).toBeNull();
  expect(order?.querySelector('.tick-foreign')?.textContent).toBe('AA F');
});

it('colours DD averages, RT prices and the summary against GP’s daily open', async () => {
  prepareBlocks();
  dailyOpen = 100;
  drilldown!.price[0] = 110;
  drilldown!.price[1] = 90;
  await render();
  await command('FLOW');
  const first = host.querySelector('.tick-blocks tbody tr')!;
  expect(first.querySelector('td:nth-child(2) .dn')?.textContent).toBe('97.1 (−2.86%)');
  expect(first.querySelector('td:nth-child(2) span')?.getAttribute('title')).toBe(
    'GP daily open 100',
  );
  await clickBlock();
  const fills = highlightedFills();
  expect(fills.map((row) => row.querySelector('td:nth-child(2) span')?.className)).toEqual([
    'mut',
    'dn',
    'up',
  ]);
  expect(fills.map((row) => cells(row)[1])).toEqual([
    '100 (0.00%)',
    '90 (−10.00%)',
    '110 (+10.00%)',
  ]);
  expect(fills.every((row) => row.querySelector('td')?.classList.contains('mut'))).toBe(true);
  expect(host.querySelector('.tick-summary-main')?.textContent).toContain(
    '90 (−10.00%) to 110 (+10.00%)',
  );
});

it.each(['sell', 'buy', 'auction'])(
  'isolates scattered %s counterparties by broker and investor tag on hover and focus',
  async (direction) => {
    prepareBlocks();
    const trades = drilldown!;
    for (const i of [0, 1, 2, 8, 10, 31, 32, 146, 361]) {
      trades.sell_order[i] = 999;
      trades.seller[i] = 'XL';
      trades.buyer[i] = 'AA';
      trades.buyer_foreign[i] = i !== 1 && i !== 8 && i !== 32;
      if (direction === 'buy') {
        trades.side[i] = 'b';
        trades.buy_order[i] = 999;
        trades.buyer[i] = 'XL';
        trades.seller[i] = 'AA';
        trades.seller_foreign[i] = trades.buyer_foreign[i]!;
      }
      if (direction === 'auction') trades.auction[i] = true;
    }
    await render();
    await command('FLOW');
    await clickBlock();
    const party = (tag: string) =>
      [...host.querySelectorAll<HTMLButtonElement>('.tick-counterparties button')].find((button) =>
        button.textContent?.startsWith(`AA ${tag}`),
      )!;
    const checkIsolated = (tag: string | null) => {
      expect(highlightedFills()).toHaveLength(9);
      for (const row of highlightedFills()) {
        const counterparty = cells(row)[direction === 'buy' ? 6 : 5];
        expect(row.classList.contains('tick-dimmed')).toBe(
          tag !== null && counterparty !== `AA ${tag}`,
        );
      }
      expect(host.querySelector('.tick-tape tr:not([data-highlighted]).tick-dimmed')).toBeNull();
    };
    checkIsolated(null);
    await act(async () => party('F').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    checkIsolated('F');
    await act(async () => party('F').dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    checkIsolated(null);
    await act(async () => party('D').focus());
    checkIsolated('D');
    // Pointer inspection temporarily overrides keyboard focus, then restores it.
    await act(async () => party('F').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    checkIsolated('F');
    await act(async () => party('F').dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    checkIsolated('D');
    await act(async () => party('D').blur());
    checkIsolated(null);
    await act(async () => party('F').focus());
    await clickBlock(2);
    expect(host.querySelector('.tick-tape .tick-dimmed')).toBeNull();
  },
);

it.each(['sell', 'buy', 'auction-sell', 'auction-buy'])(
  'shows coloured lots per price in %s execution order only for multi-price fills',
  async (direction) => {
    prepareBlocks();
    dailyOpen = 100;
    const trades = drilldown!;
    const buy = direction.endsWith('buy');
    for (let i = 0; i < 4; i++) {
      trades.price[i] = [110, 90, 100, 110][i]!;
      trades.side[i] = buy ? 'b' : 's';
      trades.auction[i] = direction.startsWith('auction');
      if (buy) {
        trades.buy_order[i] = 999;
        trades.buyer[i] = 'XL';
      } else {
        trades.sell_order[i] = 999;
        trades.seller[i] = 'XL';
      }
    }
    await render();
    await command('FLOW');
    await clickBlock();
    const line = host.querySelector('.tick-prices')!;
    const descending = direction === 'sell';
    expect([...line.children].map((item) => item.textContent)).toEqual(
      descending
        ? ['110 (+10.00%) 150', '100 (0.00%) 50', '90 (−10.00%) 200']
        : ['90 (−10.00%) 200', '100 (0.00%) 50', '110 (+10.00%) 150'],
    );
    expect([...line.querySelectorAll('span > span')].map((price) => price.className)).toEqual(
      descending ? ['up', 'mut', 'dn'] : ['dn', 'mut', 'up'],
    );
    const singlePrice = [...host.querySelectorAll('.tick-blocks tbody tr')].find(
      (row) => cells(row)[1] === '100.0 (0.00%)',
    )!;
    await act(async () => singlePrice.querySelector<HTMLElement>('button')!.click());
    expect(host.querySelector('.tick-summary')).not.toBeNull();
    expect(host.querySelector('.tick-prices')).toBeNull();
  },
);

it('shows each NEGO and CASH match with fractional lots and highlights only its RT row', async () => {
  prepareBlocks();
  const trades = drilldown!;
  // Reuse a pair of orders across two off-board trades: they must stay separate rows.
  trades.board[0] = 'NG';
  trades.board[1] = 'TN';
  trades.buy_order[1] = trades.buy_order[0]!;
  trades.shares[0] = 25;
  await render();
  await command('FLOW');
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(
      '[aria-label="Done detail"] [aria-label="Filter by broker"]',
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'XL');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const rows = [...host.querySelectorAll('.tick-blocks tbody tr')];
  const nego = rows.find((row) => cells(row)[2] === 'NEGO' && cells(row)[3] === '0.25')!;
  const cash = rows.find((row) => cells(row)[2] === 'CASH')!;
  expect(cells(nego).slice(2)).toEqual(['NEGO', '0.25', '2.5K', 'AA F', 'XL D', 'NG']);
  expect(cells(cash)[7]).toBe('TN');
  await act(async () => nego.querySelector('button')!.click());
  expect(highlightedFills()).toHaveLength(1);
  expect(cells(highlightedFills()[0]!).slice(2)).toEqual([
    'NEGO',
    '0.25',
    '2.5K',
    'AA F',
    'XL D',
    'NG',
  ]);
  expect(host.querySelector('.tick-summary-main')?.textContent).toContain('100 (0.00%)');
  expect(host.querySelector('.tick-summary-main')?.textContent).not.toContain(' to ');
  await act(async () => cash.querySelector('button')!.click());
  expect(highlightedFills()).toHaveLength(1);
  expect(cells(highlightedFills()[0]!)[2]).toBe('CASH');
  expect(cells(highlightedFills()[0]!)[7]).toBe('TN');
  await click('[aria-label="Block sort"] button:nth-child(2)');
  const times = [...host.querySelectorAll('.tick-blocks tbody tr')].map((row) => cells(row)[0]);
  expect(times).toEqual([...times].sort((a, b) => (a ?? '').localeCompare(b ?? '')));
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  for (const side of ['BUY', 'SELL']) {
    await click(`[aria-label="Trade side"] button:nth-child(${side === 'BUY' ? 2 : 3})`);
    expect(
      [...host.querySelectorAll('.tick-tape tbody tr')].every((row) => cells(row)[7] === 'RG'),
    ).toBe(true);
    await click(`[aria-label="Block side"] button:nth-child(${side === 'BUY' ? 2 : 3})`);
    expect(
      [...host.querySelectorAll('.tick-blocks tbody tr')].every((row) => cells(row)[7] === 'RG'),
    ).toBe(true);
  }
});

it('lets a small negotiated trade below the first page be reached in DD', async () => {
  prepareBlocks();
  drilldown!.board[0] = 'NG';
  drilldown!.shares[0] = 25;
  await render();
  await command('FLOW');
  const oddLot = () =>
    [...host.querySelectorAll('.tick-blocks tbody tr')].find(
      (row) => cells(row)[2] === 'NEGO' && cells(row)[3] === '0.25',
    );
  expect(oddLot()).toBeUndefined();
  await click('[aria-label="Done detail"] .tick-more');
  expect(cells(oddLot()!)[7]).toBe('NG');
});
