// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vite-plus/test';
import type { Feed } from '../data';
import { SignalsPane } from './MarketPanes';

const ownershipFeed: Feed = [76.78, 76.781, 76.8, null].map((pct_after, i) => ({
  kind: 'five_pct_change',
  ticker: `ROW${i}`,
  date: '2026-11-09',
  numbers: {
    investor: 'Holder',
    previous_date: '2026-11-06',
    shares_before: 100000,
    shares_after: pct_after === null ? null : 100001,
    net_shares: pct_after === null ? null : 1,
    pct_before: 76.78,
    pct_after,
  },
}));
let feed: Feed;
beforeEach(() => {
  feed = ownershipFeed;
});
vi.mock('./state', () => ({
  useTerminal: () => {
    const [sig, setSig] = useState('ALL');
    return {
      data: { feed },
      ticker: 'ROW0',
      pins: [],
      filters: { sig },
      filter: (_name: string, value: string) => setSig(value),
      setTicker: vi.fn<() => void>(),
      togglePin: vi.fn<() => void>(),
    };
  },
}));

it('shows ownership signals only when the displayed percentage changes, including exits', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<SignalsPane />));
    expect([...host.querySelectorAll('a.ticker')].map((e) => e.textContent)).toEqual([
      'ROW2',
      'ROW3',
    ]);
    expect(host.textContent).toContain('76.78% → 76.80%');
    expect(host.textContent).toContain('Below 5%');
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('shows today before older signals, groups kinds stably, and keeps every filter working', async () => {
  const today = '2026-11-10';
  feed = [
    ...ownershipFeed,
    {
      kind: 'ara',
      ticker: 'OLDARA',
      date: '2026-11-08',
      numbers: { prev: 100, close: 135, change_pct: 35, band_pct: 35 },
    },
    {
      kind: 'foreign_streak',
      ticker: 'FGN',
      date: today,
      numbers: { streak_days: 5, net_foreign: 1e9 },
    },
    {
      kind: 'volume_spike',
      ticker: 'VOL',
      date: today,
      numbers: { volume: 10000, avg_volume: 1000, multiple: 10, value: 1e9, prior_days: 20 },
    },
    ...['ZARA', 'AARA'].map((ticker): Feed[number] => ({
      kind: 'ara',
      ticker,
      date: today,
      numbers: { prev: 100, close: 135, change_pct: 35, band_pct: 35 },
    })),
    ...ownershipFeed.map((row) => ({ ...row, date: today, ticker: `TODAY${row.ticker}` })),
    {
      kind: 'green_on_red',
      ticker: 'RS',
      date: today,
      numbers: { change_pct: 5, market_change_pct: -2, value: 1e9 },
    },
  ];
  const sourceOrder = [...feed];
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  const tickers = () => [...host.querySelectorAll('a.ticker')].map((e) => e.textContent);
  const all = [
    'ZARA',
    'AARA',
    'VOL',
    'FGN',
    'RS',
    'TODAYROW2',
    'TODAYROW3',
    'ROW2',
    'ROW3',
    'OLDARA',
  ];
  try {
    await act(async () => root.render(<SignalsPane />));
    expect(tickers()).toEqual(all);
    for (const [label, expected] of [
      ['ARA', ['ZARA', 'AARA', 'OLDARA']],
      ['VOL', ['VOL']],
      ['FGN', ['FGN']],
      ['RS', ['RS']],
      ['5%', ['TODAYROW2', 'TODAYROW3', 'ROW2', 'ROW3']],
      ['ALL', all],
    ]) {
      const button = [
        ...host.querySelectorAll<HTMLButtonElement>('[aria-label="Signals"] button'),
      ].find((e) => e.textContent === label);
      expect(button).toBeDefined();
      await act(async () => button?.click());
      expect(button?.getAttribute('aria-pressed')).toBe('true');
      expect(tickers()).toEqual(expected);
    }
    expect(feed).toEqual(sourceOrder);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
