// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { packBars, sessionBars, type BarFile, type TickTrades } from '../ticks';
import { tradeSession } from '../test-builders';
import { loadTicks, useBars } from './tick-data';

const context = vi.hoisted(() => ({
  ticker: '',
  authState: 'signed-in',
  getToken: async () => 'test',
}));
vi.mock('./state', () => ({ useTerminal: () => context }));
const fetchTicks = vi.hoisted(() =>
  vi.fn<(ticker: string, date: string) => Promise<TickTrades | null>>(),
);
const fetchBars = vi.hoisted(() => vi.fn<(ticker: string) => Promise<BarFile | null>>());
vi.mock('./sources', () => ({ fetchTicks, fetchBars }));

let root: Root, host: HTMLDivElement;
let tickerNumber = 0;
const barsOf = (ticker: string, date: string) =>
  packBars(ticker, sessionBars(tradeSession([{ buyerForeign: true }], { date, ticker })));
function Bars() {
  const state = useBars();
  return <output>{state.kind === 'ready' ? state.data.time.length : state.kind}</output>;
}
const render = () => act(async () => root.render(<Bars />));
const shown = () => host.querySelector('output')?.textContent;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  context.ticker = `BARS${++tickerNumber}`;
  context.authState = 'signed-in';
  fetchTicks.mockReset();
  fetchBars.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('loads a ticker once for every timeframe and reloads it for another ticker', async () => {
  fetchBars.mockImplementation(async (ticker) => barsOf(ticker, '2026-11-10'));
  await render();
  expect(shown()).toBe('1');
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(fetchBars).toHaveBeenCalledTimes(1);
  context.ticker += 'NEW';
  await render();
  expect(fetchBars).toHaveBeenCalledTimes(2);
});

it('waits for sign-in and shows a ticker without collected bars as missing', async () => {
  context.authState = 'signed-out';
  await render();
  expect(shown()).toBe('loading');
  expect(fetchBars).not.toHaveBeenCalled();
  context.authState = 'signed-in';
  fetchBars.mockResolvedValue(null);
  await render();
  expect(shown()).toBe('missing');
});

it('shows the failure and asks again on the next visit', async () => {
  fetchBars.mockRejectedValueOnce(new Error('Tick data is unavailable. Retry.'));
  await render();
  expect(shown()).toBe('error');
  await act(async () => root.unmount());
  root = createRoot(host);
  fetchBars.mockImplementation(async (ticker) => barsOf(ticker, '2026-11-10'));
  await render();
  expect(fetchBars).toHaveBeenCalledTimes(2);
  expect(shown()).toBe('1');
});

it('ignores an old ticker response after the viewer changes ticker', async () => {
  let resolve!: (value: BarFile | null) => void;
  fetchBars.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  await render();
  const old = context.ticker;
  context.ticker += 'NEW';
  fetchBars.mockImplementation(async (ticker) => barsOf(ticker, '2026-11-10'));
  await render();
  await act(async () => resolve(barsOf(old, '2026-11-09')));
  expect(shown()).toBe('1');
});

it('shares one request for the same ticker, day and kind', async () => {
  fetchTicks.mockImplementation(async (ticker, date) => tradeSession([{}], { date, ticker }));
  await loadTicks(context.ticker, '2026-11-10', 'trades', context.getToken);
  await loadTicks(context.ticker, '2026-11-10', 'trades', context.getToken);
  expect(fetchTicks).toHaveBeenCalledTimes(1);
});
