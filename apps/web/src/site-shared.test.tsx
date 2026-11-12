// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Risk } from './terminal/sources';

const auth = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  signIn: vi.fn<() => Promise<void>>(async () => {}),
  signOut: vi.fn<() => void>(),
}));
vi.mock('@workos-inc/authkit-react', () => ({
  useAuth: () => ({ ...auth, isLoading: false }),
  LoginRequiredError: class extends Error {},
}));

let root: Root, host: HTMLDivElement;
const render = (ui: ReactElement) => act(async () => root.render(ui));
const find = <T extends Element>(selector: string, type: { new (...args: never[]): T }): T => {
  const el = host.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`Missing ${selector}`);
  return el;
};
const click = (selector: string) => act(async () => find(selector, HTMLElement).click());
const press = (key: string) =>
  act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
const type = (value: string) =>
  act(async () => {
    const input = find('input[type="search"]', HTMLInputElement);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
let viewport = 1024;
const phone = (width: number) => {
  viewport = width;
};
function fakeViewport() {
  const matchMedia = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
    const media = matchMedia(query);
    vi.spyOn(media, 'matches', 'get').mockReturnValue(
      query === '(max-width: 900px)' && viewport <= 900,
    );
    return media;
  });
}

beforeEach(() => {
  auth.user = null;
  auth.signOut.mockClear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fakeViewport();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  phone(1024);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('phone header', () => {
  const stocks = [
    { ticker: 'BBCA', name: 'Bank Central Asia' },
    { ticker: 'TLKM', name: 'Telkom Indonesia' },
  ];
  async function header() {
    const { SiteHeader } = await import('./SiteHeader');
    await render(<SiteHeader page="home" stocks={stocks} />);
  }
  const state = () => find('.site-header', HTMLElement).dataset.search;
  const toggle = () => find('.search-toggle', HTMLButtonElement);

  beforeEach(() => phone(390));

  it('opens search from the icon, focuses the input and finds a ticker', async () => {
    await header();
    expect(state()).toBe('closed');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    await click('.search-toggle');
    expect(state()).toBe('open');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(find('input[type="search"]', HTMLInputElement));
    await type('central');
    expect(find('.search-results a', HTMLAnchorElement).getAttribute('href')).toBe('/t/BBCA');
  });

  it('closes on Escape, on a tap outside and from the close button', async () => {
    await header();
    await click('.search-toggle');
    await type('tel');
    await press('Escape');
    await type('');
    expect(state()).toBe('closed');
    expect(host.querySelector('.search-results')).toBeNull();

    await click('.search-toggle');
    expect(state()).toBe('open');
    await act(async () => document.body.click());
    expect(state()).toBe('closed');

    await click('.search-toggle');
    await click('.search-close');
    expect(state()).toBe('closed');
  });

  it('keeps a tap inside the open search from closing it', async () => {
    await header();
    await click('.search-toggle');
    await click('input[type="search"]');
    expect(state()).toBe('open');
  });

  it('shows a Sign in button when signed out', async () => {
    await header();
    const buttons = [...host.querySelectorAll('.site-account button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Sign in']);
  });

  it('shows the first letter of the email and a sign out popover when signed in', async () => {
    auth.user = { id: 'u1', email: 'mona@example.com' };
    await header();
    const avatar = find('.site-account .avatar', HTMLButtonElement);
    expect(avatar.textContent).toBe('M');
    expect(host.querySelector('.account-popover')).toBeNull();
    await click('.avatar');
    expect(find('.account-popover', HTMLElement).textContent).toContain('mona@example.com');
    await press('Escape');
    expect(host.querySelector('.account-popover')).toBeNull();
    await click('.avatar');
    await click('.account-popover button');
    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it('keeps the inline email and Sign out on desktop', async () => {
    phone(1440);
    auth.user = { id: 'u1', email: 'mona@example.com' };
    await header();
    expect(host.querySelector('.avatar')).toBeNull();
    expect(find('.site-account', HTMLElement).textContent).toBe('mona@example.comSign out');
  });
});

describe('RiskBadge', () => {
  const flagged: Risk = {
    susp: { since: '2026-03-12', reason: 'Late financial report', url: 'https://idx.co.id/susp' },
    uma: { date: '2026-10-20', url: 'https://idx.co.id/uma' },
    notes: [
      { code: 'X', text: 'Full call auction board' },
      { code: 'E', text: 'Negative equity' },
    ],
  };
  const chips = () =>
    [...host.querySelectorAll('.risk summary .risk-chip')].map((c) => c.textContent);

  it('shows a chip per flag and explains each in the panel', async () => {
    const { RiskBadge } = await import('./RiskBadge');
    await render(<RiskBadge risk={flagged} />);
    expect(chips()).toEqual(['SUSP', 'UMA', 'FCA', 'E']);
    const details = find('details.risk', HTMLDetailsElement);
    expect(details.open).toBe(false);
    await click('.risk summary');
    expect(details.open).toBe(true);
    const panel = find('.risk-panel', HTMLElement);
    expect(panel.textContent).toContain('Suspended since 12 Mar 2026');
    expect(panel.textContent).toContain('Late financial report');
    expect(panel.textContent).toContain('Unusual market activity 20 Oct 2026');
    expect(panel.textContent).toContain('FCA Full call auction board');
    expect(panel.textContent).toContain('E Negative equity');
    expect([...panel.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      'https://idx.co.id/susp',
      'https://idx.co.id/uma',
    ]);
  });

  it('closes on Escape', async () => {
    const { RiskBadge } = await import('./RiskBadge');
    await render(<RiskBadge risk={flagged} />);
    await click('.risk summary');
    await press('Escape');
    expect(find('details.risk', HTMLDetailsElement).open).toBe(false);
  });

  it('renders nothing without flags', async () => {
    const { RiskBadge } = await import('./RiskBadge');
    await render(<RiskBadge risk={{ susp: null, uma: null, notes: [] }} />);
    expect(host.innerHTML).toBe('');
    await render(<RiskBadge risk={undefined} />);
    expect(host.innerHTML).toBe('');
  });
});

describe('published data', () => {
  it('fetches risk.json once for every component on the page', async () => {
    const fetcher = vi.fn<(input: string) => Promise<Response>>(async () =>
      Response.json({
        BBCA: { susp: null, uma: null, notes: [{ code: 'E', text: 'Negative equity' }] },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const { usePublished } = await import('./publicData');
    const { RiskBadge, useRiskFor } = await import('./RiskBadge');
    function Row({ ticker }: { ticker: string }) {
      const risk = useRiskFor(ticker);
      return (
        <p data-row={ticker}>
          <RiskBadge risk={risk} />
        </p>
      );
    }
    function State() {
      return <i>{usePublished('risk').kind}</i>;
    }
    await render(
      <>
        <State />
        <Row ticker="BBCA" />
        <Row ticker="TLKM" />
      </>,
    );
    expect(host.querySelector('i')?.textContent).toBe('ready');
    expect(fetcher.mock.calls.filter(([url]) => url === '/data/risk.json')).toHaveLength(1);
    expect(host.querySelector('[data-row="BBCA"] .risk-chip')?.textContent).toBe('E');
    expect(host.querySelector('[data-row="TLKM"] .risk')).toBeNull();
  });

  it('starts as loading and reports unavailable when the file is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    const { usePublished } = await import('./publicData');
    const seen: string[] = [];
    function Probe() {
      const resource = usePublished('calendar');
      seen.push(resource.kind);
      return null;
    }
    await render(<Probe />);
    expect(seen[0]).toBe('loading');
    expect(seen.at(-1)).toBe('unavailable');
  });
});
