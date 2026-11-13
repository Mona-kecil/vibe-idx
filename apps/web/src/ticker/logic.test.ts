import { describe, expect, it } from 'vite-plus/test';
import { dayMove } from './format';
import { tickerSchema } from '../data';
import tpiaFixture from './fixtures/TPIA-history.json';
import {
  aggregateSelection,
  attachments,
  bounds,
  composition,
  cumulativeForeign,
  holdingSeries,
  moveEdge,
  nextAction,
  ownershipEvents,
  pctAt,
  registryAt,
  selectionKey,
  sharesAt,
  summaryEvents,
  timeline,
  TIMELINE_SHOWN,
  topSeries,
  totalAt,
  pctAxis,
  periodBounds,
  selectedRows,
  visiblePrices,
  visibleWindow,
  holdingsMoved,
  withoutSource,
  chartMarks,
} from './logic';

const dates = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-21', '2026-08-24'];
const prices = dates.map((date, i) => ({
  date,
  open: null,
  high: null,
  low: null,
  close: [100, 110, 90, 120, 130][i] ?? 0,
  volume: i === 2 ? 0 : 10 + i,
  value: 1000 + i * 100,
  net_foreign: i % 2 === 0 ? -200 : 300,
}));
const data = tickerSchema.parse({
  ticker: 'TEST',
  name: 'Test issuer',
  prices,
  holders: [{ investor: 'PT Alpha Tbk', holder_key: 'ALPHA', shares: 300, pct: 30 }],
  changes: [
    {
      date: '2026-08-11',
      investor: 'Alpha',
      holder_key: 'ALPHA',
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
      holder_key: 'ALPHA',
      shares_before: 400,
      shares_after: 300,
      net_shares: -100,
      url: 'https://example.com/transfer.pdf',
    },
  ],
  registry_history: [
    {
      date: '2026-07-31',
      issued_shares: 1000,
      free_float_pct: 35,
      sid_count: 20,
      url: 'https://example.com/july.pdf',
      holders: [
        {
          investor: 'Alpha',
          holder_key: 'ALPHA',
          pct: 40,
          controller: true,
          controller_affiliate: null,
          page: 1,
        },
      ],
    },
    {
      date: '2026-08-31',
      issued_shares: 1000,
      free_float_pct: 50,
      sid_count: 25,
      url: 'https://example.com/august.pdf',
      holders: [
        {
          investor: 'Alpha',
          holder_key: 'ALPHA',
          pct: 30,
          controller: true,
          controller_affiliate: null,
          page: 1,
        },
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
    const totals = aggregateSelection(prices, { anchor: '2026-08-21', end: '2026-08-11' });
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
    expect(aggregateSelection(prices, { anchor: '2026-08-10', end: '2026-08-10' })).toMatchObject({
      change: null,
      changePct: null,
      volume: 10,
      value: 1000,
      netForeign: -200,
    });
    expect(aggregateSelection([], { anchor: '2026-08-11', end: '2026-08-21' })).toBeNull();
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

describe('month-end anchored TPIA holdings', () => {
  const tpia = tickerSchema.parse(tpiaFixture);
  const end = '2026-10-23';
  const series = holdingSeries(tpia, end);
  function holder(name: string) {
    const result = series.find((s) => s.holder_key === name);
    if (!result) throw new Error(`Missing ${name}`);
    return result;
  }

  it('keeps partial 5% reports and list exits from replacing Barito, SCG and Prajogo levels', () => {
    const barito = holder('BARITO PACIFIC');
    expect(sharesAt(barito, end)).toBe(29_957_670_400);
    expect(barito.points.some((p) => p.shares === 11_825_453_500)).toBe(false);
    expect(pctAt(tpia, barito, end)).toBeCloseTo(34.63, 2);
    expect(composition(tpia, series, end).find((p) => p.name === barito.name)?.pct).toBeCloseTo(
      34.63,
      2,
    );

    const scg = holder('SCG CHEMICALS PUBLIC COMPANY');
    expect(scg.points.every((p) => p.shares !== null)).toBe(true);
    for (const date of ['2026-02-27', '2026-03-31', '2026-04-30', '2026-05-29', '2026-06-29'])
      expect(sharesAt(scg, date)).toBe(26_446_618_924);
    for (const date of ['2026-06-30', '2026-07-31', '2026-09-30', end])
      expect(sharesAt(scg, date)).toBe(13_589_972_562);
    expect(scg.points.some((p) => p.shares === 9_144_270_316)).toBe(false);
    expect(scg.events.map((e) => [e.date, e.shares_before, e.shares_after])).toEqual(
      tpia.changes
        .filter((e) => e.holder_key === scg.holder_key)
        .map((e) => [e.date, e.shares_before, e.shares_after]),
    );

    const prajogo = holder('PRAJOGO PANGESTU');
    for (const date of ['2026-03-12', '2026-03-15'])
      expect(sharesAt(prajogo, date)).toBe(5_154_382_164);
    for (const date of ['2026-03-16', '2026-07-05', '2026-07-06', '2026-07-07', end])
      expect(sharesAt(prajogo, date)).toBe(4_354_382_164);
    expect(prajogo.points.every((p) => p.shares !== null)).toBe(true);
    expect(prajogo.events.some((e) => e.date === '2026-07-06' && e.shares_after === null)).toBe(
      true,
    );
  });

  it('starts Bangkok at its first report and ends HSBC at its last 1% month without inventing zero holdings', () => {
    const bangkok = holder('BANGKOK BANK PUBLIC COMPANY');
    expect(bangkok.points[0]).toMatchObject({ date: '2026-02-27', shares: 1_472_648_400 });
    expect(sharesAt(bangkok, '2026-02-26')).toBeUndefined();
    expect(sharesAt(bangkok, '2026-06-29')).toBe(1_472_648_400);
    expect(sharesAt(bangkok, '2026-06-30')).toBe(4_317_648_400);
    expect(sharesAt(bangkok, end)).toBe(4_317_648_400);
    expect(bangkok.points.some((p) => p.shares === 0)).toBe(false);
    const hsbc = holder('HSBC SINGAPORE BRANCH PRIVATE BANKING DIVISION ACCOUNT CLIENTS');
    expect(hsbc.points.filter((p) => p.shares !== null).map((p) => p.date)).toEqual(['2026-02-27']);
    expect(sharesAt(hsbc, '2026-02-27')).toBe(2_567_057_927);
    expect(sharesAt(hsbc, '2026-02-28')).toBeNull();
    expect(sharesAt(hsbc, end)).toBeNull();
  });

  it('keeps month-end anchors authoritative when a matched daily event falls on the same date', () => {
    const prajogo = holder('PRAJOGO PANGESTU');
    const events = ownershipEvents(tpia).filter((e) => e.holder_key !== prajogo.holder_key);
    const bangkok = holder('BANGKOK BANK PUBLIC COMPANY');
    events.push(
      {
        name: prajogo.name,
        holder_key: prajogo.holder_key,
        date: '2026-03-31',
        shares_before: 4_354_382_164,
        shares_after: 5_154_382_164,
        sources: [],
      },
      {
        name: bangkok.name,
        holder_key: bangkok.holder_key,
        date: '2026-06-30',
        shares_before: 1_472_648_400,
        shares_after: 4_317_648_400,
        sources: [],
      },
    );
    const changed = holdingSeries(tpia, end, events);
    expect(
      changed.find((s) => s.name === prajogo.name)?.points.find((p) => p.date === '2026-03-31'),
    ).toMatchObject({ shares: 4_354_382_164, event: false });
    expect(
      changed.find((s) => s.name === bangkok.name)?.points.find((p) => p.date === '2026-06-30'),
    ).toMatchObject({ shares: 4_317_648_400, event: true });
  });

  it('resumes a below-1% gap only at a later anchor and accepts legacy JSON without history', () => {
    expect(data.one_pct_history).toEqual([]);
    const hsbc = tpia.one_pct_history[0]?.holders.find((h) => h.investor.startsWith('HSBC'));
    if (!hsbc) throw new Error('Missing HSBC fixture');
    const resumed = holdingSeries(
      {
        ...tpia,
        one_pct_history: tpia.one_pct_history
          .map((m) => (m.date === '2026-06-30' ? { ...m, holders: [...m.holders, hsbc] } : m))
          .reverse(),
        registry_history: [...tpia.registry_history].reverse(),
        changes: [...tpia.changes].reverse(),
      },
      end,
    ).find((s) => s.holder_key === hsbc.holder_key);
    if (!resumed) throw new Error('Missing resumed HSBC');
    expect(sharesAt(resumed, '2026-06-29')).toBeNull();
    expect(sharesAt(resumed, '2026-06-30')).toBe(hsbc.shares);
    expect(sharesAt(resumed, '2026-07-01')).toBeNull();
  });

  it('prefers a disagreeing 1% value over the registry and seeds only unanchored daily holders', () => {
    const barito = holder('BARITO PACIFIC');
    const series = holdingSeries(
      {
        ...tpia,
        one_pct_history: tpia.one_pct_history.map((m) =>
          m.date === '2026-05-29'
            ? {
                ...m,
                holders: m.holders.map((h) =>
                  h.holder_key === barito.holder_key ? { ...h, shares: 25_000_000_000 } : h,
                ),
              }
            : m,
        ),
        holders: [
          ...tpia.holders,
          { investor: 'NEW HOLDER', holder_key: 'NEW HOLDER', shares: 5_000_000_000, pct: 5.78 },
        ],
      },
      end,
    );
    const changed = series.find((s) => s.holder_key === barito.holder_key);
    if (!changed) throw new Error('Missing Barito');
    expect(sharesAt(changed, '2026-05-31')).toBe(25_000_000_000);
    expect(sharesAt(changed, '2026-06-30')).toBe(29_957_670_400);
    expect(sharesAt(changed, '2026-09-30')).toBe(29_957_670_400);
    expect(sharesAt(changed, end)).toBe(29_957_670_400);
    const added = series.find((s) => s.name === 'NEW HOLDER');
    expect(added?.points.map((p) => [p.date, p.shares])).toEqual([[end, 5_000_000_000]]);
  });
});

it('sums Gesit accounts instead of keeping the last ALKA September row', () => {
  const alka = tickerSchema.parse({
    ticker: 'ALKA',
    name: 'ALKA',
    prices: [],
    holders: [],
    changes: [],
    one_pct_history: [
      {
        date: '2026-09-30',
        holders: [
          {
            investor: 'GESIT PERKASA, PT',
            holder_key: 'GESIT PERKASA',
            shares: 73_284_750,
            pct: 14.44,
            classification: null,
            local_foreign: null,
          },
          {
            investor: 'PT GESIT PERKASA',
            holder_key: 'GESIT PERKASA',
            shares: 352_108_805,
            pct: 69.36,
            classification: null,
            local_foreign: null,
          },
        ],
      },
    ],
  });
  expect(holdingSeries(alka, null)[0]?.points).toEqual([
    { date: '2026-09-30', shares: 425_393_555, pct: 83.8, priority: 4 },
  ]);
});

it('keeps the registry issued base when a newer monthly stake rounds to a different implied total', () => {
  const monthly = {
    date: '2026-09-30',
    holders: [
      {
        investor: 'PT Alpha',
        holder_key: 'ALPHA',
        shares: 300,
        pct: 29.99,
        classification: null,
        local_foreign: null,
      },
    ],
  };
  const ticker = { ...data, one_pct: monthly, one_pct_history: [monthly] };
  expect(totalAt(ticker, '2026-07-30')).toBeNull();
  expect(totalAt(ticker, '2026-09-30')).toBe(1000);
  expect(totalAt({ ...ticker, registry_history: [] }, '2026-09-30')).toBeNull();
  const holder = holdingSeries(ticker, null)[0];
  if (!holder) throw new Error('Missing Alpha');
  expect(pctAt(ticker, holder, '2026-09-30')).toBe(30);
});

describe('ticker page summaries', () => {
  it('sums net foreign flow into a running total that ends at the period sum', () => {
    expect(cumulativeForeign(prices)).toEqual([-200, 100, -100, 200, 0]);
    expect(cumulativeForeign(prices.slice(1, 3))).toEqual([300, 100]);
    expect(cumulativeForeign([])).toEqual([]);
  });
  it('merges filings and news newest first, labels each kind and keeps attachments on filings', () => {
    const withLamp = {
      ...data.disclosures[0]!,
      id: 'lamp',
      title: 'Lamp filing',
      published_at: '2026-08-12T09:00:00',
      attachments: [{ name: 'x_lamp1.pdf', url: 'https://example.com/lamp1.pdf' }],
    };
    const rows = timeline(
      [data.disclosures[0]!, withLamp],
      [
        {
          title: 'Wire story',
          url: 'https://example.com/news',
          published_at: 'Wed, 12 Aug 2026 04:00:00 GMT',
          source: 'Wire',
        },
      ],
    );
    expect(rows.map((r) => [r.kind, r.title])).toEqual([
      ['news', 'Wire story'],
      ['filing', 'Lamp filing'],
      ['filing', 'Older filing'],
    ]);
    expect(rows[1]?.attachments).toEqual([
      { url: 'https://example.com/lamp1.pdf', label: 'Lampiran 1' },
    ]);
    expect(rows[0]).toMatchObject({ source: 'Wire', attachments: [] });
    expect(TIMELINE_SHOWN).toBe(5);
  });
  it('keeps only the largest holders at a date and ignores holders without shares', () => {
    const mk = (key: string, shares: number | null) => ({
      holder_key: key,
      name: key,
      events: [],
      points: [{ date: '2026-08-01', shares, priority: 0 }],
    });
    const series = [
      mk('A', 10),
      mk('B', 70),
      mk('C', 5),
      mk('D', null),
      mk('E', 0),
      mk('F', 50),
      mk('G', 30),
    ];
    expect(topSeries(series, '2026-08-02').map((s) => s.name)).toEqual(['B', 'F', 'G', 'A', 'C']);
    expect(topSeries(series, '2026-08-02', 2)).toHaveLength(2);
  });
  it('puts a 1% holder and a 55% controller on one log axis', () => {
    const axis = pctAxis([55, 1.2, 1.1]);
    expect(axis.ticks).toEqual([1, 2, 5, 10, 20, 50]);
    expect(axis.position(1)).toBe(0);
    expect(axis.position(55)).toBeGreaterThan(0.8);
    expect(axis.position(1.2)).toBeGreaterThan(0.03);
  });
  describe('next corporate action', () => {
    const div = (ticker: string, ex: string) => ({
      ticker,
      kind: 'DIV' as const,
      label: 'Final dividend',
      amount: { value: 25, currency: 'IDR' },
      steps: [
        { step: 'cum' as const, date: ex.replace(/\d\d$/, '18') },
        { step: 'ex' as const, date: ex },
        { step: 'pay' as const, date: '2026-12-10' },
      ],
    });
    it('shows the earliest ex date within 30 days with every step in the title', () => {
      const chip = nextAction(
        [div('TEST', '2026-11-26'), div('TEST', '2026-11-19'), div('OTHER', '2026-11-15')],
        'TEST',
        '2026-11-13',
      );
      expect(chip?.label).toBe('Ex-div 19 Nov');
      expect(chip?.title).toBe(
        'Final dividend IDR 25\nCum date 18 Nov 2026\nEx date 19 Nov 2026\nPayment 10 Dec 2026',
      );
    });
    it('skips past dates, dates beyond 30 days and other tickers', () => {
      const actions = [
        div('TEST', '2026-11-12'),
        div('TEST', '2026-12-14'),
        div('OTHER', '2026-11-20'),
      ];
      expect(nextAction(actions, 'TEST', '2026-11-13')).toBeNull();
      expect(nextAction([div('TEST', '2026-12-13')], 'TEST', '2026-11-13')?.label).toBe(
        'Ex-div 13 Dec',
      );
      expect(nextAction([div('TEST', '2026-11-13')], 'TEST', '2026-11-13')?.label).toBe(
        'Ex-div 13 Nov',
      );
    });
  });
});

describe('chart windows', () => {
  const monthly = [
    '2026-05-12',
    '2026-06-12',
    '2026-07-12',
    '2026-08-12',
    '2026-09-12',
    '2026-10-12',
    '2026-11-12',
  ].map((date) => ({ ...prices[0]!, date }));
  const starts = (period: Parameters<typeof visiblePrices>[1]) =>
    visiblePrices(monthly, period)[0]?.date;
  it('starts each period exactly that many months before the last price and keeps YTD whole', () => {
    expect(starts('1M')).toBe('2026-10-12');
    expect(starts('3M')).toBe('2026-08-12');
    expect(starts('6M')).toBe('2026-05-12');
    expect(starts('YTD')).toBe('2026-05-12');
    expect(visiblePrices([], '3M')).toEqual([]);
  });
  it('frames a period from its first bar to a little past the last one', () => {
    const range = periodBounds(monthly, '3M');
    expect(range.from).toBe(2.5);
    expect(range.to).toBeGreaterThan(6);
    expect(range.to).toBeLessThan(10);
    expect(periodBounds(monthly, 'YTD').from).toBe(-0.5);
  });
  it('maps a logical range to the bars whose centers are visible', () => {
    expect(visibleWindow(10, { from: -0.5, to: 13 })).toEqual({ first: 0, last: 9 });
    expect(visibleWindow(10, { from: 2.4, to: 5.6 })).toEqual({ first: 3, last: 5 });
    expect(visibleWindow(10, { from: 20, to: 30 })).toBeNull();
    expect(visibleWindow(10, null)).toBeNull();
  });
  it('finds the trading days inside a selection even when its edges are not trading days', () => {
    expect(selectedRows(dates, { anchor: '2026-08-21', end: '2026-08-11' })).toEqual({
      first: 1,
      last: 3,
    });
    expect(selectedRows(dates, { anchor: '2026-08-13', end: '2026-08-30' })).toEqual({
      first: 3,
      last: 4,
    });
    expect(selectedRows(dates, { anchor: '2026-08-13', end: '2026-08-20' })).toBeNull();
    expect(selectedRows(dates, null)).toBeNull();
  });
});

describe('holdingsMoved', () => {
  const series = (shares: (number | null)[]) => ({
    holder_key: 'H',
    name: 'Holder',
    events: [],
    points: shares.map((value, i) => ({ date: `2026-0${i + 1}-01`, shares: value, priority: 0 })),
  });
  it('is false when every holder keeps the same share count', () => {
    expect(holdingsMoved([series([100, 100, null, 100]), series([5])])).toBe(false);
  });
  it('is true once any holder reports a different count', () => {
    expect(holdingsMoved([series([100, 100]), series([5, 6])])).toBe(true);
  });
});

describe('timeline cleanup and chart marks', () => {
  it('drops daily price recaps and the trailing source name from news titles', () => {
    const news = [
      {
        published_at: '2026-11-12T10:00:00',
        title: 'Harga Saham BBCA Hari Ini, 12 November',
        url: 'a',
        source: 'Pintu',
      },
      {
        published_at: '2026-11-12T09:00:00',
        title: 'BBCA buyback lanjut - Bisnis.com - Market',
        url: 'b',
        source: 'Bisnis.com - Market',
      },
    ];
    expect(timeline([], news as never).map((i) => i.title)).toEqual(['BBCA buyback lanjut']);
    expect(withoutSource('Title | CNBC Indonesia', 'CNBC Indonesia')).toBe('Title');
    expect(withoutSource('Title', '')).toBe('Title');
  });
  it('snaps marks to the next trading day and merges same-day marks of one kind', () => {
    const data = tickerSchema.parse({
      ...tickerSchema.parse(tpiaFixture),
      ticker: 'TEST',
      prices: ['2026-11-06', '2026-11-09', '2026-11-10'].map((date) => ({
        date,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
        value: 1,
        net_foreign: 0,
      })),
      disclosures: [
        {
          id: '1',
          title: 'Weekend filing',
          published_at: '2026-11-07T10:00:00',
          url: 'https://x/1',
          kind: 'other',
          attachments: [],
        },
        {
          id: '2',
          title: 'Second',
          published_at: '2026-11-09T08:00:00',
          url: 'https://x/2',
          kind: 'other',
          attachments: [],
        },
      ],
    });
    const marks = chartMarks(data, [], [
      {
        ticker: 'TEST',
        kind: 'DIV',
        label: 'Dividend',
        amount: null,
        steps: [{ step: 'ex', date: '2026-11-10' }],
      },
      {
        ticker: 'OTHER',
        kind: 'DIV',
        label: 'Dividend',
        amount: null,
        steps: [{ step: 'ex', date: '2026-11-10' }],
      },
    ] as never);
    expect(marks).toEqual([
      { date: '2026-11-09', kind: 'filing', label: 'Weekend filing\nSecond' },
      { date: '2026-11-10', kind: 'action', label: 'Ex-div' },
    ]);
  });
});

describe('dayMove', () => {
  it('names the direction so the day change reads without its sign', () => {
    expect(dayMove(2.8169)).toBe('Up 2.82% today');
    expect(dayMove(-1.96)).toBe('Down 1.96% today');
    expect(dayMove(0)).toBe('Unchanged today');
    expect(dayMove(null)).toBe('—');
  });
});
