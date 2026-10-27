import { describe, expect, it } from 'vite-plus/test';
import { tickerSchema } from '../data';
import tpiaFixture from './fixtures/TPIA-history.json';
import {
  aggregateRange,
  attachments,
  bounds,
  composition,
  holdingSeries,
  moveEdge,
  ownershipEvents,
  pctAt,
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
