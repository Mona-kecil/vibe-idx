import { describe, expect, it } from 'vite-plus/test';
import { tickerSchema } from '../data';
import {
  aggregateRange,
  attachments,
  bounds,
  composition,
  holdingSeries,
  moveEdge,
  ownershipEvents,
  registryAt,
  selectionKey,
  sharesAt,
  summaryEvents,
} from './logic';

const dates = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-21', '2026-08-24'];
const prices = dates.map((date, i) => ({
  date,
  close: [100, 110, 90, 120, 130][i] ?? 0,
  volume: i === 2 ? 0 : 10 + i,
  value: 1000 + i * 100,
  net_foreign: i % 2 === 0 ? -200 : 300,
}));
const data = tickerSchema.parse({
  ticker: 'TEST',
  name: 'Test issuer',
  prices,
  holders: [{ investor: 'PT Alpha Tbk', shares: 300, pct: 30 }],
  changes: [
    {
      date: '2026-08-11',
      investor: 'Alpha',
      shares_before: 400,
      shares_after: 300,
      net_shares: -100,
      pct_before: 40,
      pct_after: 30,
    },
  ],
  insiders: [
    {
      date: '2026-08-11',
      reporter: 'PT Alpha',
      shares_before: 400,
      shares_after: 300,
      net_shares: -100,
      url: 'https://example.com/transfer.pdf',
    },
  ],
  registry_history: [
    {
      date: '2026-07-31',
      total_shares: 1000,
      free_float_pct: 35,
      sid_count: 20,
      url: 'https://example.com/july.pdf',
      holders: [
        { investor: 'Alpha', pct: 40, controller: true, controller_affiliate: null, page: 1 },
      ],
    },
    {
      date: '2026-08-31',
      total_shares: 1000,
      free_float_pct: 50,
      sid_count: 25,
      url: 'https://example.com/august.pdf',
      holders: [
        { investor: 'Alpha', pct: 30, controller: true, controller_affiliate: null, page: 1 },
      ],
    },
  ],
  disclosures: [
    {
      id: 'older',
      title: 'Older filing',
      published_at: '2026-08-11T08:00:00',
      url: 'https://example.com/older.pdf',
      kind: 'other',
      attachments: [],
    },
    {
      id: 'newer',
      title: 'Newer filing',
      published_at: '2026-08-11T16:00:00',
      url: 'https://example.com/newer.pdf',
      kind: 'other',
      attachments: [],
    },
    {
      id: 'duplicate',
      title: 'LAPORAN KEPEMILIKAN Alpha',
      published_at: '2026-08-11T12:00:00',
      url: 'https://example.com/transfer.pdf',
      kind: 'insider',
      attachments: [],
    },
    {
      id: 'latest',
      title: 'Latest filing',
      published_at: '2026-08-21T08:00:00',
      url: 'https://example.com/latest.pdf',
      kind: 'other',
      attachments: [],
    },
  ],
});

describe('ticker selection and historical data', () => {
  it('keeps reversed anchors fixed on Shift and collapses from the active end on plain arrows', () => {
    const reversed = { anchor: dates[3] ?? '', end: dates[1] ?? '' };
    expect(bounds(reversed)).toEqual({ start: '2026-08-11', end: '2026-08-21' });
    expect(selectionKey(reversed, dates, 'ArrowRight', true)).toEqual({
      anchor: '2026-08-21',
      end: '2026-08-12',
    });
    expect(selectionKey(reversed, dates, 'ArrowLeft')).toEqual({
      anchor: '2026-08-10',
      end: '2026-08-10',
    });
    expect(
      selectionKey({ anchor: '2026-08-11', end: '2026-08-21' }, dates, 'ArrowRight', true),
    ).toEqual({ anchor: '2026-08-11', end: '2026-08-24' });
    expect(selectionKey({ anchor: '2026-08-24', end: '2026-08-24' }, dates, 'ArrowRight')).toEqual({
      anchor: '2026-08-24',
      end: '2026-08-24',
    });
    expect(selectionKey(reversed, dates, 'Escape')).toBeNull();
  });
  it('moves only the focused edge, clamps crossing handles and honors Home and End', () => {
    const selection = { anchor: '2026-08-21', end: '2026-08-11' };
    expect(moveEdge(selection, 'start', '2026-08-24')).toEqual({
      anchor: '2026-08-21',
      end: '2026-08-21',
    });
    expect(selectionKey(selection, dates, 'ArrowLeft', false, 'start')).toEqual({
      anchor: '2026-08-21',
      end: '2026-08-10',
    });
    expect(selectionKey(selection, dates, 'Home', false, 'start')).toEqual({
      anchor: '2026-08-21',
      end: '2026-08-10',
    });
    expect(selectionKey(selection, dates, 'End', false, 'start')).toEqual({
      anchor: '2026-08-21',
      end: '2026-08-21',
    });
    expect(selectionKey(selection, dates, 'Home', false, 'end')).toEqual({
      anchor: '2026-08-11',
      end: '2026-08-11',
    });
    expect(selectionKey(selection, dates, 'End', false, 'end')).toEqual({
      anchor: '2026-08-24',
      end: '2026-08-11',
    });
    expect(selectionKey(null, dates, 'ArrowRight')).toBeNull();
  });
  it('measures range change from the preceding close and sums suspended and traded rows once', () => {
    const totals = aggregateRange(prices, { anchor: '2026-08-21', end: '2026-08-11' });
    expect(totals).toMatchObject({
      close: 120,
      change: 20,
      high: 120,
      low: 90,
      volume: 24,
      value: 3600,
      netForeign: 400,
      suspended: 1,
      prior: { date: '2026-08-10', close: 100 },
    });
    expect(totals?.changePct).toBeCloseTo(20);
    expect(aggregateRange(prices, { anchor: '2026-08-10', end: '2026-08-10' })).toMatchObject({
      change: null,
      changePct: null,
      volume: 10,
      value: 1000,
      netForeign: -200,
    });
    expect(aggregateRange([], { anchor: '2026-08-11', end: '2026-08-21' })).toBeNull();
  });
  it('uses filed daily holdings for composition and only the registry known at the range end for free float', () => {
    const series = holdingSeries(data, '2026-09-01');
    const alpha = series.find((s) => s.name === 'PT Alpha Tbk');
    expect(alpha && sharesAt(alpha, '2026-08-10')).toBe(400);
    expect(alpha && sharesAt(alpha, '2026-08-21')).toBe(300);
    expect(composition(data, series, '2026-08-21')).toEqual([
      { name: 'PT Alpha Tbk', pct: 30, note: '' },
      { name: 'Free float', pct: 35, note: '2026-07-31 registry' },
      { name: 'Other', pct: 35, note: '' },
    ]);
    const sparse = { ...data, registry_history: [] };
    const sparseSeries = holdingSeries(sparse, '2026-09-01');
    expect(composition(sparse, sparseSeries, '2026-09-01').map((p) => [p.name, p.pct])).toEqual([
      ['PT Alpha Tbk', 30],
      ['Other', 70],
    ]);
    expect(composition(sparse, sparseSeries, '2026-08-21')).toEqual([]);
    expect(registryAt(data, '2026-07-01')).toBeUndefined();
    expect(composition(data, series, '2026-07-01')).toEqual([]);
    const crowded = {
      ...data,
      registry_history: data.registry_history.map((s) => ({ ...s, free_float_pct: 95 })),
    };
    expect(composition(crowded, series, '2026-08-21').map((p) => p.pct)).toEqual([30, 70, 0]);
  });
  it('merges duplicate ownership reports and interleaves filings newest first with attachments intact', () => {
    const events = ownershipEvents(data);
    expect(events).toHaveLength(1);
    expect(events[0]?.sources).toEqual(['https://example.com/transfer.pdf']);
    expect(ownershipEvents({ ...data, insiders: [] })[0]?.sources).toEqual([]);
    const rows = summaryEvents(events, data.disclosures, {
      anchor: '2026-08-11',
      end: '2026-08-21',
    });
    expect(rows.map((r) => (r.kind === 'ownership' ? r.event.name : r.filing.id))).toEqual([
      'latest',
      'Alpha',
      'newer',
      'older',
    ]);
    expect(
      summaryEvents(events, data.disclosures, { anchor: '2026-08-21', end: '2026-08-21' }),
    ).toHaveLength(1);
  });
  it('excludes cover duplicates and sorts lamp numbers before applying old and new labels', () => {
    const filing = data.disclosures[0];
    if (!filing) throw new Error('Missing filing fixture');
    expect(
      attachments({
        ...filing,
        attachments: [
          { name: 'notice_lamp10.pdf', url: 'https://example.com/10.pdf' },
          { name: 'cover.pdf', url: filing.url, label: 'Cover' },
          {
            name: 'notice_lamp2.pdf',
            url: 'https://example.com/2.pdf',
            label: 'Shareholder report',
          },
          { name: 'notice_lamp1.pdf', url: 'https://example.com/1.pdf', label: null },
        ],
      }).map((a) => [a.url, a.label]),
    ).toEqual([
      ['https://example.com/1.pdf', 'Lampiran 1'],
      ['https://example.com/2.pdf', 'Shareholder report'],
      ['https://example.com/10.pdf', 'Lampiran 10'],
    ]);
  });
});
