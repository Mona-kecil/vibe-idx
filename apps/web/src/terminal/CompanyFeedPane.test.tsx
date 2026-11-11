// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { tickerSchema, type Health, type Ticker } from '../data';
import type { Headline, Resource } from './sources';
import type { usePublications } from './state';
import { CompanyFeedPane } from './CompanyFeedPane';

const context: {
  ticker: string;
  detail: Resource<Ticker>;
  tickerNews: Resource<Headline[]>;
  publications: ReturnType<typeof usePublications>;
  data: { health: Health };
} = {
  ticker: 'UNVR',
  detail: { kind: 'loading' },
  tickerNews: { kind: 'loading' },
  publications: {
    news: { kind: 'loading' },
    actions: { kind: 'loading' },
    calendar: { kind: 'loading' },
    risks: { kind: 'loading' },
  },
  data: {
    health: {
      prices: null,
      indices: null,
      five_pct: null,
      one_pct: null,
      issuers: null,
      disclosures: '2026-11-10',
      brokers: null,
      risk: null,
      failed: [],
      run_at: '2026-11-11',
      corporate_actions: '2026-11-11',
    },
  },
};
vi.mock('./state', () => ({ useTerminal: () => context }));
const article = (title: string, ts: string): Headline => ({
  title,
  ts,
  link: `https://example.com/${title}`,
  src: 'Publisher',
  region: 'TICKER',
  sum: '',
  tags: ['UNVR'],
});
describe('company feed', () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-10T18:00:00Z'));
    context.ticker = 'UNVR';
    context.detail = {
      kind: 'ready',
      data: tickerSchema.parse({
        ticker: 'UNVR',
        name: 'Unilever',
        prices: [],
        holders: [],
        changes: [],
        disclosures: [
          {
            id: 'filing',
            title: 'Dividend announced',
            published_at: '2026-11-10T10:00:00',
            kind: 'other',
            url: 'https://idx.co.id/filing',
            attachments: [
              { name: 'dividend.pdf', url: 'https://idx.co.id/dividend.pdf', label: 'PDF' },
            ],
          },
        ],
      }),
    };
    context.tickerNews = {
      kind: 'ready',
      data: [
        article('Dividend coverage', 'Tue, 10 Nov 2026 04:00:00 GMT'),
        article('Older story', '2026-11-09T12:00:00Z'),
      ],
    };
    context.publications.news = {
      kind: 'ready',
      data: { news: [], sources: {}, errors: [], as_of: '2026-11-11' },
    };
    context.publications.actions = {
      kind: 'ready',
      data: {
        actions: [
          {
            ticker: 'UNVR',
            label: 'Dividend',
            kind: 'DIV',
            amount: { value: 50, currency: 'IDR' },
            steps: [
              { step: 'pay', date: '2026-11-26' },
              { step: 'ex', date: '2026-11-11' },
              { step: 'cum', date: '2026-11-10' },
            ],
          },
          {
            ticker: 'BBCA',
            label: 'Other company',
            kind: 'RUPS',
            amount: null,
            steps: [{ step: 'meeting', date: '2026-11-12' }],
          },
        ],
      },
    };
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const render = () => act(async () => root.render(<CompanyFeedPane />));
  it('puts today and future actions nearest first, then all history newest first in WIB', async () => {
    await render();
    const dates = [...host.querySelectorAll('tr[data-feed-kind] time:first-child')].map((el) =>
      el.getAttribute('datetime'),
    );
    expect(dates).toEqual([
      '2026-11-11',
      '2026-11-26',
      '2026-11-10T04:00:00.000Z',
      '2026-11-10T03:00:00.000Z',
      '2026-11-10',
      '2026-11-09T12:00:00.000Z',
    ]);
    expect([...host.querySelectorAll('th')].map((el) => el.textContent)).toEqual([
      'Upcoming',
      'Recent',
    ]);
    expect(host.textContent).toContain('50 IDR per share');
    expect(host.querySelector('.feed-status')?.firstElementChild?.textContent).toBe(
      'Actions as of 11 Nov 2026',
    );
    expect(host.textContent).not.toContain('Other company');
  });
  it('keeps date-only events imprecise and moves timed events into history once they pass', async () => {
    context.publications.actions = {
      kind: 'ready',
      data: {
        actions: [
          {
            ticker: 'UNVR',
            kind: 'RUPS',
            label: 'Meeting',
            amount: null,
            steps: [
              { step: 'meeting', date: '2026-11-11T00:30' },
              { step: 'record', date: '2026-11-11' },
              { step: 'pay', date: '2026-11-11T02:30' },
            ],
          },
        ],
      },
    };
    await render();
    expect(
      [...host.querySelectorAll('[data-feed-kind="action"] .feed-date time')].map((el) =>
        el.getAttribute('datetime'),
      ),
    ).toEqual(['2026-11-11', '2026-11-10T19:30:00.000Z', '2026-11-10T17:30:00.000Z']);
    expect(host.querySelector('[datetime="2026-11-11"]')?.getAttribute('title')).not.toContain(
      '00:00',
    );
    expect(
      host.querySelector('[data-source-date="2026-11-11T00:30"]')?.previousElementSibling
        ?.textContent,
    ).toBe('Recent');
    expect(host.textContent).toContain('02:30 WIB');
  });
  it('distinguishes every kind with an accessible mark and keeps exact source and attachment links', async () => {
    await render();
    expect(
      host.querySelector('[data-feed-kind="disclosure"] svg')?.getAttribute('aria-label'),
    ).toBe('IDX disclosure');
    expect(host.querySelector('[data-feed-kind="news"] svg')?.getAttribute('aria-label')).toBe(
      'News',
    );
    expect(host.querySelector('[data-feed-kind="action"] svg')?.getAttribute('aria-label')).toBe(
      'Corporate action',
    );
    expect(
      new Set([...host.querySelectorAll('svg path')].map((el) => el.getAttribute('d'))).size,
    ).toBe(3);
    expect(host.querySelector('[data-feed-kind="disclosure"] a')?.getAttribute('href')).toBe(
      'https://idx.co.id/filing',
    );
    expect(host.querySelector('.filing-attachments a')?.getAttribute('href')).toBe(
      'https://idx.co.id/dividend.pdf',
    );
    const link = host.querySelector('[data-feed-kind="news"] a');
    expect(link?.getAttribute('href')).toBe('https://example.com/Dividend coverage');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('title')).toContain('Publisher');
  });
  it('deduplicates identical news URLs while retaining independent reporting of a disclosed event', async () => {
    context.publications.news = {
      kind: 'ready',
      data: {
        news: [article('Dividend coverage', '2026-11-10T04:00:00Z')],
        sources: {},
        errors: [],
      },
    };
    await render();
    expect(host.querySelectorAll('[data-feed-kind="news"]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-feed-kind="disclosure"]')).toHaveLength(1);
    expect(host.textContent).toContain('Dividend announced');
    expect(host.textContent).toContain('Dividend coverage');
  });
  it('names missing coverage and empty results separately, and clears ticker-specific items', async () => {
    context.tickerNews = { kind: 'unavailable' };
    context.publications.actions = { kind: 'ready', data: { actions: [] } };
    await render();
    expect(host.textContent).toContain('Ticker news unavailable');
    expect(host.querySelector('[data-feed-empty="action"]')?.textContent).toBe(
      'No corporate actions for UNVR as of 11 Nov 2026',
    );
    expect(host.querySelectorAll('.feed-status [data-feed-empty="action"]')).toHaveLength(1);
    expect(host.querySelector('.feed-status')?.firstElementChild?.className).toBe('feed-asof');
    context.ticker = 'BBCA';
    context.detail = { kind: 'loading' };
    context.tickerNews = { kind: 'ready', data: [] };
    await render();
    expect(host.querySelectorAll('[data-feed-kind]')).toHaveLength(0);
    expect(host.querySelector('[data-feed-empty="news"]')?.textContent).toBe('No news for BBCA');
    expect(host.textContent).toContain('Loading Disclosures');
    context.data.health.corporate_actions = null;
    await render();
    expect(host.textContent).toContain('No corporate actions for BBCA; reporting date unavailable');
    context.data.health.corporate_actions = '2026-11-11';
  });
});
