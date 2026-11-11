// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vite-plus/test';
import type { Feed, Stock, MarketSummary } from '../data';
import { MoversPane, SignalsPane } from './MarketPanes';

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
let priceDate: string;
beforeEach(() => {
  feed = ownershipFeed;
  priceDate = '2026-11-10';
});
vi.mock('./state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./state')>();
  return {
    ...actual,
    useTerminal: () => {
      const [filters, setFilters] = useState(actual.initialFilters);
      return {
        data: {
          feed,
          stocks: moverStocks,
          summary: moverSummary,
          health: { prices: priceDate },
        },
        ticker: 'AAA',
        pins: [],
        filters,
        filter: (name: string, value: string) =>
          setFilters((current) => ({ ...current, [name]: value })),
        setTicker: vi.fn<() => void>(),
        togglePin: vi.fn<() => void>(),
      };
    },
  };
});
const moverStocks: Stock[] = [
  {
    ticker: 'AAA',
    name: 'A',
    close: 110,
    change_pct: 10,
    value: 1000,
    volume: 100,
    net_foreign: 20,
  },
  {
    ticker: 'BBB',
    name: 'B',
    close: 95,
    change_pct: -5,
    value: 3000,
    volume: 100,
    net_foreign: -30,
  },
  {
    ticker: 'CCC',
    name: 'C',
    close: 102,
    change_pct: 2,
    value: 2000,
    volume: 100,
    net_foreign: 10,
  },
];
const moverSummary: MarketSummary = {
  date: '2026-11-10',
  stocks: moverStocks.map((stock, i) => ({
    ticker: stock.ticker,
    name: stock.name,
    close: stock.close,
    windows: {
      '1d': { change_pct: stock.change_pct, value: stock.value, rel_volume: 1 },
      '3d': { change_pct: [-8, 4, 6][i] ?? 0, value: [9000, 1000, 5000][i] ?? 0, rel_volume: 1 },
      '5d': { change_pct: [1, 12, -3][i] ?? 0, value: [1000, 8000, 2000][i] ?? 0, rel_volume: 1 },
    },
  })),
};

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
    expect([...host.querySelectorAll('tbody')].map((el) => el.getAttribute('aria-label'))).toEqual([
      '10 Nov 2026 signals',
      '9 Nov 2026 signals',
      '8 Nov 2026 signals',
    ]);
    expect(host.querySelectorAll('tbody:first-child tr.ticker-row')).toHaveLength(7);
    expect(host.textContent?.match(/10 Nov 2026/g)).toHaveLength(1);
    expect(host.querySelectorAll('tr.ticker-row td')).toHaveLength(all.length * 3);
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

async function withMovers(check: (host: HTMLDivElement) => Promise<void>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MoversPane />));
    await check(host);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
}
function ranking(host: HTMLDivElement, name: 'Change' | 'Value') {
  return [...host.querySelectorAll(`[aria-label="${name} ranking"] a.ticker`)].map(
    (el) => el.textContent,
  );
}
async function press(host: HTMLDivElement, label: string) {
  const button = [...host.querySelectorAll('button')].find((el) => el.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button?.click());
  expect(button?.getAttribute('aria-pressed')).toBe('true');
}
it('shows change and value rankings together with the columns needed to read each', async () => {
  await withMovers(async (host) => {
    expect(ranking(host, 'Change')).toEqual(['AAA', 'CCC', 'BBB']);
    expect(ranking(host, 'Value')).toEqual(['BBB', 'CCC', 'AAA']);
    expect(
      [...host.querySelectorAll('[aria-label="Change ranking"] th')].map((el) => el.textContent),
    ).toEqual(['TICKER', 'LAST IDR', 'CHG']);
    expect(
      [...host.querySelectorAll('[aria-label="Value ranking"] th')].map((el) => el.textContent),
    ).toEqual(['TICKER', 'CHG', 'VALUE IDR']);
    expect(host.querySelectorAll('.pin-button')).toHaveLength(6);
    expect(host.querySelector('a.ticker')?.getAttribute('href')).toBe('/terminal?t=AAA&l=focus');
  });
});
it('toggles each ranking independently, including foreign buys and sells', async () => {
  await withMovers(async (host) => {
    await press(host, 'LOSE');
    expect(ranking(host, 'Change')).toEqual(['BBB', 'CCC', 'AAA']);
    expect(ranking(host, 'Value')).toEqual(['BBB', 'CCC', 'AAA']);
    await press(host, 'F BUY');
    expect(ranking(host, 'Value')).toEqual(['AAA', 'CCC', 'BBB']);
    expect(host.querySelector('[aria-label="Value ranking"]')?.textContent).toContain(
      'F NET EST. IDR',
    );
    await press(host, 'F SELL');
    expect(ranking(host, 'Value')).toEqual(['BBB', 'CCC', 'AAA']);
    expect(ranking(host, 'Change')).toEqual(['BBB', 'CCC', 'AAA']);
    await press(host, 'VALUE');
    await press(host, 'GAIN');
    expect(ranking(host, 'Change')).toEqual(['AAA', 'CCC', 'BBB']);
    expect(ranking(host, 'Value')).toEqual(['BBB', 'CCC', 'AAA']);
  });
});
it('shares the period across both rankings and keeps foreign estimates at one session', async () => {
  await withMovers(async (host) => {
    expect(host.querySelectorAll('[aria-label="Mover period"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="Mover period"]')?.closest('.mover-list')).toBeNull();
    await press(host, '3d');
    expect(ranking(host, 'Change')).toEqual(['CCC', 'BBB', 'AAA']);
    expect(ranking(host, 'Value')).toEqual(['AAA', 'CCC', 'BBB']);
    expect(host.querySelector('[aria-label="Change ranking"]')?.textContent).toContain('−8.00%');
    expect(host.querySelector('[aria-label="Value ranking"]')?.textContent).toContain('9.0K');
    await press(host, '5d');
    expect(ranking(host, 'Change')).toEqual(['BBB', 'AAA', 'CCC']);
    expect(ranking(host, 'Value')).toEqual(['BBB', 'CCC', 'AAA']);
    await press(host, 'F BUY');
    expect(
      host.querySelector('[aria-label="Mover period"] [aria-pressed="true"]')?.textContent,
    ).toBe('1d');
    expect(ranking(host, 'Change')).toEqual(['AAA', 'CCC', 'BBB']);
    expect(
      [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Mover period"] button')].map(
        (el) => el.disabled,
      ),
    ).toEqual([false, true, true]);
    await press(host, 'VALUE');
    await press(host, '3d');
    expect(ranking(host, 'Change')).toEqual(['CCC', 'BBB', 'AAA']);
    expect(ranking(host, 'Value')).toEqual(['AAA', 'CCC', 'BBB']);
  });
});

it('places the reporting date below the shared controls and preserves a different foreign date', async () => {
  priceDate = '2026-11-09';
  await withMovers(async (host) => {
    const controls = host.querySelector('.mover-controls');
    expect(controls?.nextElementSibling?.textContent).toBe('As of 10 Nov 2026');
    await press(host, 'F BUY');
    const foreignControls = host.querySelector('.seg[aria-label="Value movers"]')?.parentElement;
    expect(foreignControls?.nextElementSibling?.textContent).toBe('As of 9 Nov 2026');
    expect(
      host
        .querySelector('[aria-label="Value movers"]')
        ?.closest('section')
        ?.querySelector('.pb .publication'),
    ).toBeNull();
  });
});
