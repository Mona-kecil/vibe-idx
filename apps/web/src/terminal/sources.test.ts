import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { fetchActions, fetchBrokers, fetchCalendar, fetchHeadlines, fetchRisk } from './sources';
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
      '/data/corporate-actions.json': {
        as_of: timestamp,
        actions: [
          {
            ticker: 'BREN',
            kind: 'DIV',
            label: 'Dividend',
            amount: 12.5,
            steps: [{ step: 'pay', date: '2026-11-10' }],
          },
        ],
      },
      '/data/risk.json': {
        as_of: timestamp,
        risk: { BREN: { notes: [{ code: 'X', text: 'Watchlist board' }], susp: null, uma: null } },
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
    expect(actions.kind === 'ready' && actions.data.actions[0]?.amount).toBe(12.5);
    expect(risk.kind === 'ready' && risk.data.as_of).toBe(timestamp);
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
  it('accepts the prototype risk publication date and rejects unsafe article URLs and invalid timestamps', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    fetcher.mockResolvedValueOnce(Response.json({ asof: '2026-11-09', risk: {} }));
    expect((await fetchRisk()).kind).toBe('ready');
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
