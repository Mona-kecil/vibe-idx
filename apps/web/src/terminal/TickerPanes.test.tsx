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
let detailData = ticker;
const select = vi.fn<(value: Selection) => void>((value) => {
  selection = value;
});
vi.mock('./state', () => ({
  useTerminal: () => ({
    data: { health: { five_pct: '2026-11-09' } },
    detail: { kind: 'ready', data: detailData },
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
  detailData = ticker;
  select.mockClear();
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it('shows registry facts above the holders with the reporting date available on hover', async () => {
  await act(async () => root.render(<HoldersPane />));
  const registry = host.querySelector('dl');
  expect([...(registry?.querySelectorAll('div') ?? [])].map((el) => el.textContent)).toEqual([
    'FREE FLOAT40.00%',
    'SID COUNT1,000',
    'ISSUED SHARES10,000',
  ]);
  expect(registry?.title).toBe('Registry 31 Oct 2026');
  expect(registry?.nextElementSibling?.querySelector('[aria-label="Holder A"]')).not.toBeNull();
  selection = { anchor: '2026-10-01', end: '2026-10-30' };
  await act(async () => root.render(<HoldersPane />));
  expect(host.querySelector('dl')?.title).toBe('Registry unavailable');
  expect([...host.querySelectorAll('dl dd')].map((el) => el.textContent)).toEqual(['—', '—', '—']);
});
it('shares one percentage chart with inspectable reports and range changes', async () => {
  await act(async () => root.render(<HoldersPane />));
  expect(host.querySelectorAll('.holder-history')).toHaveLength(2);
  const holder = host.querySelector('[aria-label="Holder A"]');
  expect(host.querySelectorAll('.holders-chart svg')).toHaveLength(1);
  expect(host.querySelectorAll('[data-holder="a"] circle')).toHaveLength(3);
  expect(holder?.querySelector('.holder-change')?.textContent).toBe('+0.11 pp');
  expect(holder?.querySelector('summary')?.textContent).toContain('Holder A');
  expect(holder?.querySelector('.holder-name')?.getAttribute('title')).toBe('Holder A');
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
it('merges monthly accounts and daily reports once per holder, preferring exact monthly totals over registry rounding', async () => {
  const monthlyHolder = (investor: string, holder_key: string, pct: number) => ({
    investor,
    holder_key,
    pct,
    shares: pct * 100,
    classification: null,
    local_foreign: null,
  });
  detailData = tickerSchema.parse({
    ...ticker,
    registry_history: [
      {
        ...ticker.registry_history[0],
        holders: [
          {
            investor: 'Old C',
            holder_key: 'c',
            pct: 1.3,
            controller: false,
            controller_affiliate: true,
            page: 1,
          },
        ],
      },
    ],
    one_pct_history: [
      { date: '2026-11-09', holders: [monthlyHolder('Stale C', 'c', 1.4)] },
      { date: '2026-10-30', holders: [monthlyHolder('Old C', 'c', 1.25)] },
    ],
    one_pct: {
      date: '2026-11-09',
      holders: [
        monthlyHolder('Holder A alias', 'a', 9.1),
        monthlyHolder('Holder C', 'c', 0.7),
        monthlyHolder('Holder C', 'c', 0.8),
        monthlyHolder('Holder D', 'd', 1.1),
      ],
    },
  });
  await act(async () => root.render(<HoldersPane />));
  expect(
    [...host.querySelectorAll('.holder-history')].map((e) => e.getAttribute('aria-label')),
  ).toEqual(['Holder A', 'Holder C', 'Holder D', 'Exited holder']);
  const holder = host.querySelector('[aria-label="Holder C"]');
  expect([...(holder?.querySelectorAll('tbody tr') ?? [])].map((e) => e.textContent)).toEqual([
    '9 Nov 20261.50%150',
    '30 Oct 20261.25%125',
  ]);
  expect(holder?.querySelector('[aria-label="Controller affiliate"]')?.textContent).toBe('AFFIL');
  expect(host.querySelector('[aria-label="Holder A"] b')?.textContent).toBe('9.11%');
  selection = { anchor: '2026-10-01', end: '2026-10-30' };
  await act(async () => root.render(<HoldersPane />));
  expect(host.querySelectorAll('.holder-history')).toHaveLength(3);
  expect(host.querySelector('[aria-label="Holder C"] b')?.textContent).toBe('1.25%');
  expect(host.querySelector('.holder-role')).toBeNull();
  expect(host.querySelector('.holder-range')?.textContent).toContain(
    'Chart range 1 Oct 2026 to 30 Oct 2026',
  );
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.holder-range button')?.click();
    root.render(<HoldersPane />);
  });
  expect(host.querySelectorAll('.holder-history')).toHaveLength(4);
});
it('uses registry roles at the chart range end and gives controllers precedence over affiliates', async () => {
  detailData = tickerSchema.parse({
    ...ticker,
    registry_history: [
      {
        ...ticker.registry_history[0],
        holders: [
          {
            investor: 'Holder A alias',
            holder_key: 'a',
            pct: 9.1,
            controller: true,
            controller_affiliate: true,
            page: 1,
          },
        ],
      },
      {
        ...ticker.registry_history[0],
        date: '2025-10-31',
        holders: [
          {
            investor: 'Holder A alias',
            holder_key: 'a',
            pct: 9,
            controller: false,
            controller_affiliate: true,
            page: 1,
          },
        ],
      },
    ],
  });
  await act(async () => root.render(<HoldersPane />));
  expect(host.querySelector('[aria-label="Controller"]')?.textContent).toBe('CTRL');
  expect(host.querySelectorAll('.holder-role')).toHaveLength(1);
  selection = { anchor: '2025-11-01', end: '2025-11-30' };
  await act(async () => root.render(<HoldersPane />));
  expect(host.querySelector('[aria-label="Controller affiliate"]')?.textContent).toBe('AFFIL');
  expect(host.querySelector('[aria-label="Controller"]')).toBeNull();
});
it('ends a monthly history below 1% when the holder leaves subsequent snapshots', async () => {
  detailData = tickerSchema.parse({
    ...ticker,
    one_pct_history: [
      {
        date: '2026-09-30',
        holders: [
          {
            investor: 'Monthly exit',
            holder_key: 'exit',
            pct: 1.2,
            shares: 120,
            classification: null,
            local_foreign: null,
          },
        ],
      },
    ],
    one_pct: { date: '2026-10-30', holders: [] },
  });
  await act(async () => root.render(<HoldersPane />));
  const holder = host.querySelector('[aria-label="Monthly exit"]');
  expect(holder?.querySelector('b')?.textContent).toBe('Below 1%');
  expect(host.querySelectorAll('[data-holder="exit"] circle')).toHaveLength(1);
  expect(holder?.querySelector('.holder-change')?.textContent).toBe('−0.20 pp or more');
  expect(holder?.querySelector('tbody tr')?.textContent).toBe('30 Oct 2026Below 1%—');
  selection = { anchor: '2026-09-01', end: '2026-09-30' };
  await act(async () => root.render(<HoldersPane />));
  expect(host.querySelector('[aria-label="Monthly exit"] b')?.textContent).toBe('1.20%');
});
it('shows six lines, previews every holder on focus and allows replacing a pinned line', async () => {
  detailData = tickerSchema.parse({
    ...ticker,
    holders: Array.from({ length: 8 }, (_, i) => ({
      holder_key: `h${i}`,
      investor: `Holder ${i}`,
      pct: 20 - i,
      shares: (20 - i) * 100,
    })),
    changes: [],
  });
  await act(async () => root.render(<HoldersPane />));
  expect(host.querySelectorAll('.holder-history')).toHaveLength(8);
  expect(host.querySelectorAll('.holders-chart [data-holder]')).toHaveLength(6);
  const holder = host.querySelector('[aria-label="Holder 7"]');
  await act(async () => {
    holder?.querySelector('summary')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  });
  expect(host.querySelector('.holders-chart [data-holder="h7"]')).not.toBeNull();
  expect(host.querySelector('.holders-chart [data-holder="h0"]')?.getAttribute('opacity')).toBe(
    '0.18',
  );
  await act(async () => {
    holder?.querySelector<HTMLButtonElement>('button')?.click();
    holder?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  expect(holder?.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelectorAll('.holders-chart [data-holder]')).toHaveLength(6);
  expect(host.querySelector('.holders-chart [data-holder="h7"]')).not.toBeNull();
  expect(host.querySelector('.holders-chart [data-holder="h0"]')).toBeNull();
});
it('keeps ten key figures with formatted price and registry dates and current-ticker pinning', async () => {
  await act(async () => root.render(<DescriptionPane />));
  expect(host.querySelectorAll('dd')).toHaveLength(10);
  expect(host.textContent).toContain('PRICE DATE9 Nov 2026');
  expect(host.textContent).toContain('REGISTRY DATE31 Oct 2026');
  expect(host.querySelector('[aria-label="Pin TEST"]')).not.toBeNull();
});

it.each([
  { first: 14.72, last: null, text: '−9.72 pp or more', direction: 'dn' },
  { first: null, last: 14.72, text: '+9.72 pp or more', direction: 'up' },
  { first: 4, last: null, text: '—', direction: 'mut' },
  { first: null, last: 4, text: '—', direction: 'mut' },
  { first: null, last: null, text: '—', direction: 'mut' },
])(
  'preserves the strict change bound for $first to $last',
  async ({ first, last, text, direction }) => {
    detailData = tickerSchema.parse({
      ...ticker,
      holders: [],
      registry_history: [],
      changes: [first, last].map((pct_after, i) => ({
        ...ticker.changes[0],
        date: i === 0 ? '2026-10-01' : '2026-11-01',
        pct_after,
      })),
    });
    await act(async () => root.render(<HoldersPane />));
    const change = host.querySelector('.holder-change');
    expect(change?.textContent).toBe(text);
    expect(change?.className).toBe(`holder-change ${direction}`);
    expect(change?.getAttribute('title')).toContain('exact change unknown');
  },
);

it.each([
  { pct: 9.002, text: '+0.00 pp', exact: '+0.002 pp' },
  { pct: 8.998, text: '−0.00 pp', exact: '−0.002 pp' },
  { pct: 9, text: '0.00 pp', exact: '0 pp' },
])(
  'rounds small changes consistently while retaining $exact on hover',
  async ({ pct, text, exact }) => {
    detailData = tickerSchema.parse({
      ...ticker,
      holders: [{ ...ticker.holders[0], pct }],
      changes: [ticker.changes[0]],
    });
    await act(async () => root.render(<HoldersPane />));
    const change = host.querySelector('.holder-change');
    expect(change?.textContent).toBe(text);
    expect(change?.getAttribute('title')).toContain(`exact change ${exact}`);
  },
);
