// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  fetchActions,
  fetchBrokers,
  fetchCalendar,
  fetchHeadlines,
  fetchRisk,
  type Headline,
  type Resource,
} from './sources';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RiskPane } from './PublicationPanes';
afterEach(() => vi.unstubAllGlobals());
const timestamp = '2026-11-09T08:00:00Z';
describe('terminal publications', () => {
  it('reads only published JSON, retains summaries, publication dates and dividend amounts', async () => {
    const payloads = {
      '/data/news.json': {
        as_of: timestamp,
        news: [
          {
            ts: timestamp,
            src: 'Publisher',
            title: 'Headline',
            link: 'https://example.com/news',
            region: 'ID',
            sum: 'Own summary',
            tags: ['BREN'],
          },
        ],
      },
      '/data/calendar.json': {
        as_of: timestamp,
        cal: [
          {
            ts: timestamp,
            c: 'ID',
            imp: 3,
            ev: 'Decision',
            url: 'https://example.com/calendar',
            by: 'Publisher',
          },
        ],
      },
      '/data/corporate-actions.json': [
        {
          ticker: 'BREN',
          kind: 'DIV',
          label: 'Cash dividend',
          amount: { value: 0.034, currency: 'USD' },
          steps: [{ step: 'pay', date: '2026-11-10' }],
        },
      ],
      '/data/risk.json': {
        BREN: { notes: [{ code: 'X', text: 'Watchlist board' }], susp: null, uma: null },
      },
    };
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = requestUrl(input);
      const payload = Object.entries(payloads).find(([key]) => key === path)?.[1];
      if (!payload) throw new Error('Unexpected source');
      return Response.json(payload);
    });
    vi.stubGlobal('fetch', fetcher);
    const news = await fetchHeadlines(),
      calendar = await fetchCalendar(),
      actions = await fetchActions(),
      risk = await fetchRisk();
    expect(news.kind === 'ready' && news.data.news[0]?.sum).toBe('Own summary');
    expect(calendar.kind === 'ready' && calendar.data.as_of).toBe(timestamp);
    expect(actions.kind === 'ready' && actions.data.actions[0]?.amount).toEqual({
      value: 0.034,
      currency: 'USD',
    });
    expect(risk.kind === 'ready' && risk.data.risk.BREN?.notes[0]?.code).toBe('X');
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(Object.keys(payloads));
  });
  it('reads the raw action array and ticker-keyed risk object published by the daily batch', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    fetcher.mockResolvedValueOnce(
      Response.json([
        {
          ticker: 'BREN',
          kind: 'DIV',
          label: 'Cash dividend',
          steps: [{ step: 'pay', date: '2026-11-10' }],
        },
      ]),
    );
    const actions = await fetchActions();
    expect(actions.kind === 'ready' && actions.data.actions[0]?.ticker).toBe('BREN');
    fetcher.mockResolvedValueOnce(
      Response.json({
        BREN: { notes: [{ code: 'X', text: 'Watchlist board' }], susp: null, uma: null },
      }),
    );
    const risk = await fetchRisk();
    expect(risk.kind === 'ready' && risk.data.risk.BREN?.notes[0]?.code).toBe('X');
  });
  it('settles missing, malformed and failing files as unavailable without retrying', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    for (const response of [
      new Response('', { status: 404 }),
      Response.json({ news: [{}] }),
      Response.json({ cal: [] }, { status: 503 }),
      new Response('not json'),
    ]) {
      fetcher.mockResolvedValueOnce(response);
      expect(await fetchHeadlines()).toEqual({ kind: 'unavailable' });
    }
    fetcher.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchRisk()).toEqual({ kind: 'unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it('rejects unsafe article URLs and invalid timestamps', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    for (const item of [
      { ts: timestamp, link: 'javascript:alert(1)' },
      { ts: 'not a date', link: 'https://example.com' },
    ]) {
      fetcher.mockResolvedValueOnce(
        Response.json({
          news: [{ ...item, src: 'Publisher', title: 'Headline', region: 'ID', tags: [] }],
        }),
      );
      expect((await fetchHeadlines()).kind).toBe('unavailable');
    }
  });
  it('authenticates broker reads, handles missing histories and validates ticker identity', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    fetcher.mockResolvedValueOnce(Response.json({ ticker: 'BREN', days: [] }));
    expect(await fetchBrokers('BREN', 'test')).toEqual([]);
    expect(fetcher).toHaveBeenCalledWith('/api/brokers?ticker=BREN', {
      headers: { Authorization: 'Bearer test' },
      cache: 'no-store',
      signal: undefined,
    });
    fetcher.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(fetchBrokers('BREN', 'expired')).rejects.toThrow('Sign in again');
    fetcher.mockResolvedValueOnce(Response.json({ ticker: 'BBCA', days: [] }));
    await expect(fetchBrokers('BREN', 'test')).rejects.toThrow('mismatch');
    fetcher.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await fetchBrokers('BREN', 'test')).toEqual([]);
  });
});

function requestUrl(input: RequestInfo | URL) {
  return input instanceof Request ? input.url : input.toString();
}

const context: {
  publications: {
    news: Awaited<ReturnType<typeof fetchHeadlines>>;
    calendar: Awaited<ReturnType<typeof fetchCalendar>>;
    actions: Awaited<ReturnType<typeof fetchActions>>;
    risks: Awaited<ReturnType<typeof fetchRisk>>;
  };
  tickerNews: Resource<Headline[]>;
  ticker: string;
  filters: { news: string; cal: string; ca: string; risk: string };
  filter: ReturnType<typeof vi.fn>;
  setTicker: ReturnType<typeof vi.fn>;
  data: { health: { corporate_actions: string; risk: string } };
} = {
  publications: {
    news: { kind: 'unavailable' },
    calendar: { kind: 'unavailable' },
    actions: { kind: 'unavailable' },
    risks: { kind: 'unavailable' },
  },
  tickerNews: { kind: 'unavailable' },
  ticker: 'BBRI',
  filters: { news: 'ID', cal: 'ALL', ca: 'ALL', risk: 'ALL' },
  filter: vi.fn<(key: string, value: string) => void>(),
  setTicker: vi.fn<(ticker: string) => void>(),
  data: { health: { corporate_actions: '2026-11-09', risk: '2026-11-09' } },
};
vi.mock('./state', () => ({ useTerminal: () => context }));

describe('publication pane interactions', () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    context.filters.news = 'ID';
    context.setTicker.mockClear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });
  async function click(selector: string) {
    const button = host.querySelector(selector);
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing ${selector}`);
    await act(async () => button.click());
  }
  it('formats risk dates and exposes full flag meanings without hover', async () => {
    context.publications.risks = {
      kind: 'ready',
      data: {
        risk: {
          BBCA: {
            susp: {
              since: '2026-11-06T00:30',
              reason: 'Financial reporting sanctions',
              url: 'https://example.com/suspension',
            },
            uma: null,
            notes: [
              { code: 'S', text: 'No operating revenue' },
              { code: 'X', text: 'Watchlist board' },
            ],
          },
        },
      },
    };
    await act(async () => root.render(createElement(RiskPane)));
    expect(host.querySelector('tr td:nth-child(3)')?.textContent).toBe('6 Nov 2026');
    expect(host.querySelector('[aria-label="S: No operating revenue"]')).not.toBeNull();
    await click('[aria-label="Risk details for BBCA"]');
    expect(host.querySelector('.details')?.textContent).toContain('No operating revenue');
    expect(host.querySelector('.details')?.textContent).toContain('Watchlist board');
    expect(host.querySelector('.details a')?.getAttribute('href')).toBe(
      'https://example.com/suspension',
    );
  });
});
