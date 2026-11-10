// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  fetchActions,
  fetchBrokers,
  fetchCalendar,
  fetchHeadlines,
  fetchRisk,
  fetchTickerNews,
  type Headline,
  type Resource,
} from './sources';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NewsPane, CalendarPane, ActionsPane, RiskPane } from './PublicationPanes';
import { calendarEventSchema } from './contracts';
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

describe('publication source presentation', () => {
  it('strips only a matching trailing publisher from ticker headlines', async () => {
    const titles = [
      'Profit rises - CNBC Indonesia',
      'Profit - outlook improves - CNBC Indonesia',
      'Profit rises – cnbc indonesia',
      'Profit rises - Another publisher',
      'CNBC Indonesia expects growth',
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          titles.map((title, i) => ({
            title,
            source: 'CNBC Indonesia',
            published_at: timestamp,
            url: `https://example.com/${i}`,
          })),
        ),
      ),
    );
    const news = await fetchTickerNews('BBRI');
    expect(news.kind === 'ready' && news.data.map((item) => item.title)).toEqual([
      'Profit rises',
      'Profit - outlook improves',
      'Profit rises',
      'Profit rises - Another publisher',
      'CNBC Indonesia expects growth',
    ]);
  });
  it('identifies published date-only events without hiding a real midnight release', () => {
    const event = {
      ts: '2026-11-10T17:00:00Z',
      c: 'ID',
      imp: 3,
      ev: 'Decision',
      url: 'https://example.com',
      by: 'Publisher',
    };
    expect(calendarEventSchema.parse({ ...event, source_id: 'bi' }).dateOnly).toBe(true);
    expect(
      calendarEventSchema.parse({ ...event, source_id: 'bps', est: 'Expected release' }).dateOnly,
    ).toBe(true);
    expect(
      calendarEventSchema.parse({ ...event, est: 'Date only; release time not published' })
        .dateOnly,
    ).toBe(true);
    expect(calendarEventSchema.parse({ ...event, source_id: 'forexfactory' }).dateOnly).toBe(false);
    expect(calendarEventSchema.parse({ ...event, source_id: 'bi', dateOnly: false }).dateOnly).toBe(
      false,
    );
  });
  it('keeps partial rows and explains missing and stale sources with their last update', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          as_of: timestamp,
          sources: {
            bps: { status: 'unavailable', as_of: null, attempted_at: timestamp },
            bi: { status: 'stale', as_of: timestamp, attempted_at: '2026-11-10T08:00:00Z' },
          },
          errors: ['bps calendar unavailable', 'bi calendar unavailable'],
          cal: [
            {
              ts: timestamp,
              c: 'ID',
              imp: 3,
              ev: 'Decision',
              url: 'https://example.com',
              by: 'Publisher',
            },
          ],
        }),
      ),
    );
    const calendar = await fetchCalendar();
    expect(calendar.kind === 'ready' && calendar.data.cal).toHaveLength(1);
    expect(calendar.kind === 'ready' && calendar.data.errors).toEqual([
      'BPS releases missing',
      'Bank Indonesia decisions not updated since 9 Nov 2026',
    ]);
  });
  it('translates legacy failure text when no source status is published', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ cal: [], errors: ['bps calendar unavailable'] })),
    );
    const calendar = await fetchCalendar();
    expect(calendar.kind === 'ready' && calendar.data.errors).toEqual(['BPS releases missing']);
  });
});

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
    context.filters.ca = 'ALL';
    context.filters.cal = 'ALL';
    context.ticker = 'BBRI';
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
  it('replaces the list with a reader and preserves next, previous and close controls', async () => {
    context.filters.news = 'TICKER';
    context.tickerNews = {
      kind: 'ready',
      data: [0, 1].map((i) => ({
        ts: `2026-11-09T0${9 - i}:00:00Z`,
        src: 'Publisher',
        title: `Story ${i}`,
        link: `https://example.com/${i}`,
        region: 'TICKER',
        sum: `Summary ${i}`,
        tags: ['BBRI', 'BBCA'],
      })),
    };
    await act(async () => root.render(createElement(NewsPane)));
    expect(host.querySelectorAll('.tags span').length).toBe(2);
    expect(host.querySelector('.tags')?.textContent).toBe('BBCA');
    expect(host.querySelector('[aria-label="Open news in"]')).toBeNull();
    await click('.news-item');
    expect(host.querySelectorAll('.news-item')).toHaveLength(0);
    expect(host.querySelector('.reader')?.textContent).toContain('Summary 0');
    expect(host.querySelector('.reader .tags')?.textContent).toBe('BBCA');
    await click('[aria-label="Next article"]');
    expect(host.querySelector('.reader')?.textContent).toContain('Summary 1');
    await click('[aria-label="Previous article"]');
    expect(host.querySelector('.reader')?.textContent).toContain('Summary 0');
    await click('[aria-label="Close reader"]');
    expect(host.querySelector('.reader')).toBeNull();
    expect(host.querySelectorAll('.news-item')).toHaveLength(2);
  });
  it('expands a corporate action without switching ticker and keeps the ticker link active', async () => {
    context.publications.actions = {
      kind: 'ready',
      data: {
        actions: [
          {
            ticker: 'BBCA',
            kind: 'DIV',
            label: 'Dividend',
            amount: null,
            steps: [
              { step: 'pay', date: '2026-11-10' },
              { step: 'meeting', date: '2026-11-11T10:00' },
            ],
          },
        ],
      },
    };
    await act(async () => root.render(createElement(ActionsPane)));
    await click('.actions td.l button');
    expect(host.querySelector('.details')?.textContent).toContain('10 Nov 2026');
    expect(context.setTicker).not.toHaveBeenCalled();
    expect(host.querySelector('.details')?.textContent).toContain('11 Nov, 10:00 WIB');
    const link = host.querySelector('a.ticker');
    if (!(link instanceof HTMLAnchorElement)) throw new Error('Missing ticker');
    await act(async () => link.click());
    expect(context.setTicker).toHaveBeenCalledWith('BBCA');
  });
  it('leaves date-only times empty, keeps past rows and reveals forecast values on expansion', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-11T06:00:00Z'));
    const event = { c: 'ID', imp: 3, ev: 'Decision', url: 'https://example.com', by: 'Publisher' };
    context.publications.calendar = {
      kind: 'ready',
      data: {
        as_of: timestamp,
        errors: [],
        sources: {},
        cal: [
          calendarEventSchema.parse({ ...event, ts: '2026-11-09T17:00:00Z', source_id: 'bi' }),
          calendarEventSchema.parse({
            ...event,
            ts: '2026-11-10T17:00:00Z',
            source_id: 'bi',
            f: '5%',
            p: '4%',
          }),
          calendarEventSchema.parse({
            ...event,
            ts: '2026-11-11T17:00:00Z',
            source_id: 'forexfactory',
          }),
        ],
      },
    };
    await act(async () => root.render(createElement(CalendarPane)));
    expect(host.querySelectorAll('.past')).toHaveLength(1);
    expect(host.querySelector('[data-upcoming="true"] td')?.textContent).toBe('');
    expect(host.querySelector('.day')?.textContent).toBe('10 Nov 2026');
    const rows = host.querySelectorAll('tbody tr:not(.day)');
    expect(rows[2]?.querySelector('td')?.textContent).toBe('00:00');
    expect(host.querySelectorAll('th')).toHaveLength(4);
    await click('[data-upcoming="true"] button');
    expect(host.querySelector('.details')?.textContent).toContain('Forecast5%');
    expect(host.querySelector('.details')?.textContent).toContain('Previous4%');
  });
  it('keeps today’s action steps upcoming in WIB and updates the target for ticker filters', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-10T18:00:00Z'));
    context.publications.actions = {
      kind: 'ready',
      data: {
        actions: [
          {
            ticker: 'BBCA',
            kind: 'DIV',
            label: 'Dividend',
            amount: null,
            steps: [
              { step: 'cum', date: '2026-11-10T23:30' },
              { step: 'ex', date: '2026-11-11T00:30' },
              { step: 'pay', date: '2026-11-12' },
            ],
          },
          {
            ticker: 'BBRI',
            kind: 'RUPS',
            label: 'Meeting',
            amount: null,
            steps: [{ step: 'meeting', date: '2026-11-12' }],
          },
        ],
      },
    };
    await act(async () => root.render(createElement(ActionsPane)));
    expect(host.querySelectorAll('.actions .past')).toHaveLength(1);
    expect(host.querySelector('.past')?.textContent).toContain('CUMBBCA');
    expect(host.querySelector('[data-upcoming="true"]')?.textContent).toContain('EXBBCA');
    context.filters.ca = 'TICKER';
    await act(async () => root.render(createElement(ActionsPane)));
    expect(host.querySelectorAll('.actions .ticker')).toHaveLength(1);
    expect(host.querySelector('[data-upcoming="true"]')?.textContent).toContain('RUPSBBRI');
    context.ticker = 'BBCA';
    await act(async () => root.render(createElement(ActionsPane)));
    expect(host.querySelectorAll('.actions .ticker')).toHaveLength(3);
    expect(host.querySelector('[data-upcoming="true"]')?.textContent).toContain('EXBBCA');
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-13T06:00:00Z'));
    await act(async () => root.render(createElement(ActionsPane)));
    expect(host.querySelectorAll('.actions .past')).toHaveLength(3);
    expect(host.querySelector('[data-upcoming="true"]')).toBeNull();
  });
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
