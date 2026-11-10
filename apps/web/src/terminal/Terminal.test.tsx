// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { Terminal } from './Terminal';
import { cumulativeFlows } from './BrokerPanes';
import type { BrokerDay } from '../brokers';

const auth = vi.hoisted(() => ({
  user: null as { id: string } | null,
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
      run_at: '2026-11-09',
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
      prices: [],
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
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/terminal?t=BREN&l=grid');
  window.localStorage.clear();
  auth.user = null;
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
    expect(host.textContent).toContain('No broker summary in this view');
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
});

function requestUrl(input: RequestInfo | URL) {
  return input instanceof Request ? input.url : input.toString();
}
