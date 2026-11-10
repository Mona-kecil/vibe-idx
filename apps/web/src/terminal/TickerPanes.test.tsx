// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { tickerSchema } from '../data';
import type { Selection } from '../ticker/logic';
import { DescriptionPane, HoldersPane } from './TickerPanes';

const ticker = tickerSchema.parse({
  ticker: 'TEST',
  name: 'Company TEST',
  prices: [{ date: '2026-11-09', close: 100, volume: 1000, value: 100000, net_foreign: 100 }],
  holders: [{ investor: 'Holder A', holder_key: 'a', shares: 911, pct: 9.11 }],
  changes: [
    {
      date: '2025-11-06',
      investor: 'Holder A',
      holder_key: 'a',
      shares_before: 899,
      shares_after: 900,
      net_shares: 1,
      pct_before: 8.99,
      pct_after: 9,
    },
    {
      date: '2026-10-06',
      investor: 'Holder A',
      holder_key: 'a',
      shares_before: 900,
      shares_after: 910,
      net_shares: 10,
      pct_before: 9,
      pct_after: 9.1,
    },
    {
      date: '2026-11-09',
      investor: 'Holder A',
      holder_key: 'a',
      shares_before: 910,
      shares_after: 911,
      net_shares: 1,
      pct_before: 9.1,
      pct_after: 9.11,
    },
    {
      date: '2026-10-09',
      investor: 'Exited holder',
      holder_key: 'b',
      shares_before: 501,
      shares_after: null,
      net_shares: null,
      pct_before: 5.01,
      pct_after: null,
    },
  ],
  registry_history: [
    {
      date: '2026-10-31',
      free_float_pct: 40,
      sid_count: 1000,
      issued_shares: 10000,
      url: 'https://example.com/registry.pdf',
    },
  ],
});
let selection: Selection = null;
const select = vi.fn<(value: Selection) => void>((value) => {
  selection = value;
});
vi.mock('./state', () => ({
  useTerminal: () => ({
    data: { health: { five_pct: '2026-11-09' } },
    detail: { kind: 'ready', data: ticker },
    ticker: 'TEST',
    selection,
    select,
    pins: [],
    togglePin: vi.fn<(ticker: string) => void>(),
  }),
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  selection = null;
  select.mockClear();
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it('groups holder reports into dated charts with inspectable percentages and shares', async () => {
  await act(async () => root.render(<HoldersPane />));
  expect(host.querySelectorAll('.holder-history')).toHaveLength(2);
  const holder = host.querySelector('[aria-label="Holder A"]');
  expect(holder?.querySelectorAll('svg circle')).toHaveLength(3);
  expect(holder?.querySelector('summary')?.textContent).toBe('Reported values (3)');
  expect(holder?.querySelector('.holder-dates')?.textContent).toBe('6 Nov 20259 Nov 2026');
  expect([...(holder?.querySelectorAll('tbody tr') ?? [])].map((e) => e.textContent)).toEqual([
    '9 Nov 20269.11%911',
    '6 Oct 20269.10%910',
    '6 Nov 20259.00%900',
  ]);
  const exited = host.querySelector('[aria-label="Exited holder"]');
  expect(exited?.textContent).toContain('Below 5%');
  expect(exited?.querySelector('svg')).toBeNull();
});
it('shows an active chart range even with no holder reports and clears it from HDS', async () => {
  selection = { anchor: '2026-11-01', end: '2026-11-02' };
  await act(async () => root.render(<HoldersPane />));
  expect(host.querySelector('.holder-range')?.textContent).toContain(
    'Chart range 1 Nov 2026 to 2 Nov 2026',
  );
  expect(host.textContent).toContain('No holder reports in this chart range');
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.holder-range button')?.click();
    root.render(<HoldersPane />);
  });
  expect(select).toHaveBeenCalledWith(null);
  expect(host.querySelector('.holder-range')).toBeNull();
  expect(host.querySelectorAll('.holder-history')).toHaveLength(2);
});
it('keeps ten key figures with formatted price and registry dates and current-ticker pinning', async () => {
  await act(async () => root.render(<DescriptionPane />));
  expect(host.querySelectorAll('dd')).toHaveLength(10);
  expect(host.textContent).toContain('PRICE DATE9 Nov 2026');
  expect(host.textContent).toContain('REGISTRY DATE31 Oct 2026');
  expect(host.querySelector('[aria-label="Pin TEST"]')).not.toBeNull();
});
