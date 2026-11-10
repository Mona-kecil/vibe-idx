// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vite-plus/test';
import type { Feed } from '../data';
import { SignalsPane } from './MarketPanes';

const feed: Feed = [76.78, 76.781, 76.8, null].map((pct_after, i) => ({
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
vi.mock('./state', () => ({
  useTerminal: () => ({
    data: { feed },
    ticker: 'ROW0',
    pins: [],
    filters: { sig: '5%' },
    filter: vi.fn<() => void>(),
    setTicker: vi.fn<() => void>(),
    togglePin: vi.fn<() => void>(),
  }),
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
