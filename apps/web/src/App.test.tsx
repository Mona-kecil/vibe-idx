// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';
import { BrokerView } from './BrokerPanel';
import { LocaleProvider } from './locale';
import { brokerHistorySchema } from './brokers';
import { defaultBrokerCodes, inventorySeries, accountIdentity } from './broker-data';
import { chartSegments } from './Chart';
import { initialWorkspace, layoutKey, makePanel, type WorkspaceState } from './workspace';
import type { Ticker } from './data';

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
    prices: dates.map((date) => ({ date, close: 100, volume: 700, value: 70000, net_foreign: 0 })),
    holders: [{ investor: 'Synthetic holder', shares: 100, pct: 10 }],
    changes: [],
    one_pct: { date: '2026-09-30', holders: [] },
    insiders: [],
    disclosures: [],
    registry: null,
  };
}
let root: Root;
let host: HTMLDivElement;
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
      ['SINI', 'BBCA', 'BREN'].map((symbol) => ({
        ticker: symbol,
        name: symbol,
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
      history: dates.slice(1).map((date) => ({ date, close: 5000, change: 10, change_pct: 1 })),
    });
  if (url.includes('feed.json') || url.includes('/api/news')) return Response.json([]);
  const symbol = /ticker\/([A-Z]+).json/.exec(url)?.[1];
  return Response.json(ticker(symbol ?? 'SINI'));
});
function element<T extends Element>(selector: string, type: { new (...args: never[]): T }): T {
  const el = host.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`Missing ${selector}`);
  return el;
}
const button = (selector: string) => element(selector, HTMLButtonElement);
async function click(selector: string) {
  await act(async () => button(selector).click());
}
async function select(selector: string, value: string) {
  await act(async () => {
    const el = element(selector, HTMLSelectElement);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function render() {
  await act(async () => root.render(<App initialUrl={window.location.pathname} />));
}
function saved(): WorkspaceState {
  return JSON.parse(window.localStorage.getItem(layoutKey) ?? '{}');
}
beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  auth.user = null;
  auth.getAccessToken.mockClear();
  auth.getAccessToken.mockResolvedValue('test-token');
  fetcher.mockClear();
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

describe('research workspace', () => {
  it('keeps unlinked Broksum tickers and controls independent, relinks from the active panel, and restores the layout', async () => {
    auth.user = { id: 'fixture-user', email: 'fixture@example.test' };
    window.history.replaceState(null, '', '/t/BBCA');
    await render();
    await click('[aria-label="Broksum panel actions"] + .panel-menu-list button');
    expect(host.querySelectorAll('[aria-label="Broksum panel"]')).toHaveLength(2);
    await click('.link-toggle');
    await select('[data-panel-id="p1"] .panel-ticker', 'BBCA');
    await select('[data-panel-id="p5"] .panel-ticker', 'BREN');
    await select('[data-panel-id="p1"] [aria-label="Broker measure"]', 'value');
    await select('[data-panel-id="p5"] [aria-label="Broker flow"]', 'gross');
    expect(element('[data-panel-id="p1"] .panel-ticker', HTMLSelectElement).value).toBe('BBCA');
    expect(element('[data-panel-id="p5"] .panel-ticker', HTMLSelectElement).value).toBe('BREN');
    expect(
      element('[data-panel-id="p5"] [aria-label="Broker measure"]', HTMLSelectElement).value,
    ).toBe('shares');
    expect(
      element('[data-panel-id="p1"] [aria-label="Broker flow"]', HTMLSelectElement).value,
    ).toBe('net');
    await act(async () => {
      const input = element('[data-panel-id="p1"] [aria-label="Range start"]', HTMLInputElement);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        dates[1],
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const from = saved().panels.find((panel) => panel.id === 'p1')?.state.from;
    expect(from).toBe('2026-10-20');
    await act(async () => element('[data-panel-id="p5"] .panel-ticker', HTMLSelectElement).focus());
    await click('.link-toggle');
    for (const el of host.querySelectorAll<HTMLSelectElement>('.panel-ticker'))
      expect(el.value).toBe('BREN');
    expect(saved().panels.find((panel) => panel.id === 'p1')?.state.from).toBe(from);
    expect(
      element('[data-panel-id="p1"] [aria-label="Broker measure"]', HTMLSelectElement).value,
    ).toBe('value');
    await click('[data-panel-id="p5"] .panel-menu-list button:nth-child(2)');
    await act(async () =>
      button('[data-panel-id="p5"] .panel-resize').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      ),
    );
    const before = saved();
    const navigation = {
      name: '/t/BBCA',
      entryType: 'navigation',
      duration: 0,
      startTime: 0,
      type: 'reload',
      toJSON: () => ({}),
    };
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([navigation]);
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(saved()).toEqual(before);
    expect(host.querySelector('[data-panel-id="p5"]')?.getAttribute('style')).toContain('570px');
    await click('[data-panel-id="p5"] [aria-label="Focus Broksum"]');
    expect(host.querySelectorAll('.module-panel')).toHaveLength(1);
    await click('[aria-label="Show all panels Broksum"]');
    expect(host.querySelectorAll('.module-panel')).toHaveLength(5);
    await click('[data-panel-id="p5"] [aria-label="Remove Broksum panel"]');
    expect(host.querySelectorAll('.module-panel')).toHaveLength(4);
  });
  it('opens /t/BBCA on public data without requesting broker tokens or private data and translates the workspace', async () => {
    window.history.replaceState(null, '', '/t/BBCA');
    await render();
    for (const el of host.querySelectorAll<HTMLSelectElement>('.panel-ticker'))
      expect(el.value).toBe('BBCA');
    expect(host.textContent).toContain('Sign in to view broker summary');
    expect(host.textContent).toContain('Company BBCA');
    expect(auth.getAccessToken).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/api/brokers'))).toBe(false);
    await select('.workspace-tools select', 'id');
    expect(host.textContent).toContain('Ruang kerja Anda.');
    expect(host.textContent).toContain('Masuk untuk melihat ringkasan broker');
    expect(host.textContent).toContain('Ringkasan pasar');
    expect(window.localStorage.getItem('vibe-idx-language')).toBe('id');
  });
  it('does not send an empty bearer token even when a user object exists', async () => {
    auth.user = { id: 'fixture-user', email: 'fixture@example.test' };
    auth.getAccessToken.mockResolvedValue(undefined);
    await render();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/api/brokers'))).toBe(false);
    expect(host.textContent).toContain('Sign in');
  });
  it('plots data-derived buyers and sellers and breaks inventory at an absent session instead of adding zero', async () => {
    const history = brokerHistorySchema.parse({ ticker: 'BBCA', days });
    const codes = defaultBrokerCodes(history.days);
    expect(codes).toEqual(['AK', 'SQ', 'PD', 'CC']);
    expect(
      defaultBrokerCodes([
        { date: dates[0] ?? '2026-10-19', buy: [row('ZZ', 9)], sell: [row('YY', 9)] },
      ]),
    ).toEqual(['ZZ', 'YY']);
    const incomplete = history.days.filter((day) => day.date !== dates[2]);
    const series = inventorySeries(incomplete, dates, codes, 'shares');
    expect(series[0]?.points.map((point) => point.value)).toEqual([500, 1000, null, null]);
    expect(series[0]?.points.at(-1)?.delta).toBe(500);
    expect(chartSegments(series[0]?.points ?? [])).toHaveLength(1);
    const controls = makePanel('p1', 'brokers', 'BBCA').state;
    await act(async () =>
      root.render(
        <LocaleProvider>
          <BrokerView
            days={incomplete}
            tradingDates={dates}
            controls={controls}
            update={() => {}}
          />
        </LocaleProvider>,
      ),
    );
    expect(host.textContent).toContain('Missing broker dates');
    expect(host.textContent).toContain('2026-10-21');
    expect(
      host.querySelector('[data-series="AK"] polyline')?.getAttribute('points')?.split(' '),
    ).toHaveLength(2);
    expect(host.textContent).toContain('Change since 2026-10-19');
    expect(host.querySelectorAll('.broker-sides')).toHaveLength(2);
    expect(accountIdentity('BANK CENTRAL ASIA Tbk, PT')?.kind).toBe('custodian');
    expect(accountIdentity('PT BCA SEKURITAS')).toEqual({ kind: 'broker', code: 'SQ' });
  });
  it('shows every panel when the stored focus names a removed panel', async () => {
    window.localStorage.setItem(
      layoutKey,
      JSON.stringify({ ...initialWorkspace(), activeId: 'p99', focusId: 'p99' }),
    );
    await render();
    expect(host.querySelectorAll('.module-panel')).toHaveLength(4);
  });
  it('adds any module and preserves independent dates while linked ticker changes propagate', async () => {
    const state = initialWorkspace();
    state.panels[0] = makePanel('p1', 'price', 'SINI');
    window.localStorage.setItem(layoutKey, JSON.stringify(state));
    await render();
    await click('[aria-label="Add News module"]');
    expect(host.querySelectorAll('.module-panel')).toHaveLength(5);
    await select('[data-panel-id="p1"] .panel-ticker', 'BBCA');
    for (const el of host.querySelectorAll<HTMLSelectElement>('.panel-ticker'))
      expect(el.value).toBe('BBCA');
    expect(saved().panels.find((panel) => panel.type === 'news')?.state.from).toBe('');
    await act(async () =>
      element('[data-panel-id="p1"] .chart-legend input', HTMLInputElement).click(),
    );
    expect(host.querySelector('[data-panel-id="p1"] [data-series="IHSG"]')).not.toBeNull();
    expect(
      host.querySelector('[data-panel-id="p1"] [data-plot-date]')?.getAttribute('data-plot-date'),
    ).toBe('2026-10-20');

    await click('[aria-label="Collapse module sidebar"]');
    expect(host.querySelector('.desk.collapsed')).not.toBeNull();
  });
});
