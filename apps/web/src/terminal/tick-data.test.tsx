// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { tickerSchema } from '../data';
import { tickTradesSchema, type TickTrades } from '../ticks';
import { loadTicks, useTradeSessions } from './tick-data';

const context = vi.hoisted(() => ({
  ticker: '',
  authState: 'signed-in',
  getToken: async () => 'test',
  detail: { kind: 'ready', data: { prices: [] as { date: string }[] } },
  tickDate: null,
  setTickDate: () => {},
}));
vi.mock('./state', () => ({ useTerminal: () => context }));
const fetchTicks = vi.hoisted(() =>
  vi.fn<(ticker: string, date: string) => Promise<TickTrades | null>>(),
);
vi.mock('./sources', () => ({ fetchTicks }));

let root: Root, host: HTMLDivElement;
let tickerNumber = 0;
const dates = Array.from({ length: 8 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
function trades(date: string) {
  return tickTradesSchema.parse({
    ticker: context.ticker,
    date,
    time: [32400],
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
function History({ batchSize = 2 }: { batchSize?: number }) {
  const { state, loadMore } = useTradeSessions(batchSize);
  return (
    <>
      <output>
        {state.kind === 'ready' ? state.data.map((s) => s.date).join(',') : state.kind}
      </output>
      <button onClick={loadMore}>Older</button>
    </>
  );
}
async function render(batchSize = 2) {
  await act(async () => root.render(<History batchSize={batchSize} />));
}
async function older() {
  await act(async () => host.querySelector('button')?.click());
}
const shown = () => host.querySelector('output')?.textContent;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  context.ticker = `HISTORY${++tickerNumber}`;
  context.detail = {
    kind: 'ready',
    data: tickerSchema.parse({
      ticker: context.ticker,
      name: 'History',
      holders: [],
      changes: [],
      prices: ['2025-12-31', ...dates].map((date) => ({
        date,
        close: 100,
        volume: 100,
        value: 10000,
        net_foreign: 0,
      })),
    }),
  };
  context.authState = 'signed-in';
  fetchTicks.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('prepends older batches, skips isolated missing sessions and shares the request cache', async () => {
  fetchTicks.mockResolvedValueOnce(trades(dates[6]!)).mockResolvedValueOnce(trades(dates[7]!));
  await render();
  expect(shown()).toBe(dates.slice(6).join(','));
  fetchTicks.mockResolvedValueOnce(null).mockResolvedValueOnce(trades(dates[5]!));
  await older();
  expect(shown()).toBe([dates[5], ...dates.slice(6)].join(','));
  fetchTicks.mockResolvedValueOnce(trades(dates[2]!)).mockResolvedValueOnce(trades(dates[3]!));
  await older();
  expect(shown()).toBe([...dates.slice(2, 4), dates[5], ...dates.slice(6)].join(','));
  await loadTicks(context.ticker, dates[7]!, 'trades', context.getToken);
  await loadTicks(context.ticker, dates[4]!, 'trades', context.getToken);
  expect(fetchTicks).toHaveBeenCalledTimes(6);
});

it('stops after a whole older batch is missing and keeps the collected session', async () => {
  fetchTicks
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(trades(dates[7]!))
    .mockResolvedValue(null);
  await render();
  await older();
  await older();
  await older();
  expect(fetchTicks).toHaveBeenCalledTimes(4);
  expect(shown()).toBe(dates[7]);
});

it('stops immediately when the initial batch is entirely missing', async () => {
  fetchTicks.mockResolvedValue(null);
  await render();
  await older();
  expect(fetchTicks).toHaveBeenCalledTimes(2);
  expect(shown()).toBe('');
});

it('requests the remaining short batch once and never asks for pre-2026 dates', async () => {
  fetchTicks.mockImplementation(async (_ticker, date) => trades(date));
  await render(5);
  await older();
  await older();
  expect(fetchTicks).toHaveBeenCalledTimes(8);
  expect(fetchTicks.mock.calls.map((call) => call[1])).toEqual([
    ...dates.slice(3),
    ...dates.slice(0, 3),
  ]);
});

it('coalesces repeated left-edge notifications while a batch is pending', async () => {
  fetchTicks.mockResolvedValueOnce(trades(dates[6]!)).mockResolvedValueOnce(trades(dates[7]!));
  await render();
  let resolve!: (value: TickTrades | null) => void;
  const pending = new Promise<TickTrades | null>((done) => {
    resolve = done;
  });
  fetchTicks.mockReturnValue(pending);
  await older();
  await older();
  expect(fetchTicks).toHaveBeenCalledTimes(4);
  await act(async () => resolve(null));
  await older();
  expect(fetchTicks).toHaveBeenCalledTimes(4);
  expect(shown()).toBe(dates.slice(6).join(','));
});

it('ignores an old ticker response after the viewer changes ticker', async () => {
  let resolve!: (value: TickTrades | null) => void;
  const pending = new Promise<TickTrades | null>((done) => {
    resolve = done;
  });
  fetchTicks.mockReturnValue(pending);
  await render();
  context.ticker += 'NEW';
  fetchTicks.mockResolvedValue(trades(dates[7]!));
  await render();
  const latest = shown();
  await act(async () => resolve(trades(dates[0]!)));
  expect(shown()).toBe(latest);
});
