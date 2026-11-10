// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { Terminal } from './Terminal';
import { cumulativeFlows, foreignFlow } from './BrokerPanes';
import type { BrokerDay } from '../brokers';

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
        ? ['2026-11-06', '2026-11-09'].map((date) => ({
            date,
            close: 7675,
            volume: 100,
            value: 767500,
            net_foreign: 0,
          }))
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
    expect(host.querySelectorAll('.pane')).toHaveLength(2);
    expect(window.location.search).toContain('l=focus');
    await click('.pane .maxb');
    expect(host.querySelector('.pane.max')).not.toBeNull();
    await click('.pane.max .maxb');
    expect(host.querySelector('.pane.max')).toBeNull();
    await click('.lay button:nth-child(3)');
    expect(host.querySelectorAll('.pane')).toHaveLength(4);
    expect(host.textContent).not.toContain('SAMPLE');
    expect(host.querySelector('[role="tab"][title="Order book"]')).toBeNull();
  });
  it('renders missing publications once and resets scrolling on filter changes', async () => {
    await render();
    expect(host.textContent).toContain('News unavailable');
    await click('[data-slot="c"] [role="tab"]:nth-child(3)');
    expect(host.textContent).toContain('Calendar unavailable');
    const body = host.querySelector<HTMLDivElement>('[data-slot="c"] .pb');
    if (!body) throw new Error('Missing body');
    body.scrollTop = 120;
    await click('[aria-label="Calendar"] button:nth-child(2)');
    expect(body.scrollTop).toBe(0);
    await click('[data-slot="c"] [role="tab"]:nth-child(4)');
    expect(host.textContent).toContain('Corporate actions unavailable');
    await click('[data-slot="d"] [role="tab"]:nth-child(2)');
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
    await click('[data-slot="e"] .empty button');
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
    expect(host.querySelectorAll('.pane')).toHaveLength(2);
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
    await click('[aria-label="Movers"] button:nth-child(4)');
    await click('[data-slot="d"] [aria-label="Pin BBCA"]');
    expect(window.location.search).toContain('t=BREN');
    expect(host.querySelector('[data-slot="a"] a.ticker')?.textContent).toBe('BBCA');
    await act(async () => {
      host
        .querySelector('[data-slot="d"] tbody tr:nth-child(2) td:last-child')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(window.location.search).toContain('t=BBCA');
    const link = host.querySelector('[data-slot="d"] tbody tr:nth-child(2) a.ticker');
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
    expect(rows[0]?.querySelector('.tick-foreign')?.textContent).toBe('YP');
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
  expect(host.querySelector('[data-slot="b"] .ctx b')?.textContent).toBe('BREN');
  expect(host.querySelectorAll('.pane')).toHaveLength(6);
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

it('keeps ticker identity without duplicating the price in pane headers', async () => {
  await render();
  const contexts = [...host.querySelectorAll('.ctx')].filter((el) => el.querySelector('b'));
  expect(contexts).toHaveLength(3);
  expect(contexts.every((el) => el.textContent === 'BREN')).toBe(true);
});

it('uses one tab stop per pane tablist and segment group with arrow navigation', async () => {
  await render();
  for (const list of host.querySelectorAll('.tabs, .seg')) {
    expect([...list.querySelectorAll('button')].filter((el) => el.tabIndex === 0)).toHaveLength(1);
  }
  const tab = button('[data-slot="c"] [aria-selected="true"]');
  await act(async () => {
    tab.focus();
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  expect(document.activeElement?.textContent).toBe('SIG');
  const panel = host.querySelector('[data-slot="c"] [role="tabpanel"]');
  expect(document.activeElement?.getAttribute('aria-controls')).toBe(panel?.id);
  expect(panel?.getAttribute('aria-labelledby')).toBe(document.activeElement?.id);
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
  expect(host.textContent).toContain('Checking sign-in…');
  expect([...host.querySelectorAll('button')].some((el) => el.textContent === 'Sign in')).toBe(
    false,
  );
});
