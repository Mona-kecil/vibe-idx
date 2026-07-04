import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vite-plus/test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  App,
  DailyPriceSortSelector,
  DailyPricesTable,
  FivePctDateSelector,
  FivePctOwnershipTable,
  SnapshotDateSelector,
  createListFilters,
  dailyPricesPrefetchPages,
  keepPreviousListResult,
  nextPageFilters,
  pageFromPaginationHotkey,
  prefetchPageFilters,
  prefetchSequentially,
  renderAppTitle,
  rowIndexFromKeyboard,
} from './App';

describe('App', () => {
  it('renders the Vibe IDX title', () => {
    expect(renderAppTitle()).toBe('Vibe IDX');
  });

  it('renders the primary market data surfaces', () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('Daily Prices');
    expect(markup).toContain('5% Ownership');
    expect(markup).toContain('1% Ownership');
    expect(markup).toContain('Insider Transactions');
  });

  it('renders 5% ownership as expandable summaries with account details', () => {
    const rows = [
      {
        id: 'shareholder:AADI:ADARO STRATEGIC INVESTMENTS',
        accountCount: 3,
        accounts: [
          {
            id: 'account-a',
            accountHolderName: 'CITIBANK, N. A',
            brokerCode: null,
            accountName: 'BOS LTD S/A PT ADARO STRATEGIC INVESTMENTS',
            actualChange: 1000000,
            currentPercent: 41.12,
            currentShares: 69000000,
            currentSidTotal: 3201000000,
            investorStatus: 'L',
            previousPercent: 41.1,
            previousShares: 68000000,
            previousSidTotal: 3200000000,
            reportedChange: 1000000,
          },
          {
            id: 'account-b',
            accountHolderName: 'PT BANK DBS INDONESIA',
            brokerCode: null,
            accountName: 'DBS BANK LTD SG S/A PT ADARO STRATEGIC INVESTMENTS',
            actualChange: 0,
            currentPercent: 41.12,
            currentShares: 10000000,
            currentSidTotal: 3201000000,
            investorStatus: 'L',
            previousPercent: 41.1,
            previousShares: 10000000,
            previousSidTotal: 3200000000,
            reportedChange: 0,
          },
          {
            id: 'account-c',
            accountHolderName: 'PT SUCOR SEKURITAS',
            brokerCode: 'AZ',
            accountName: 'PT ADARO STRATEGIC INVESTMENTS - SUCOR',
            actualChange: 0,
            currentPercent: null,
            currentShares: 1000,
            currentSidTotal: null,
            investorStatus: 'L',
            previousPercent: null,
            previousShares: 1000,
            previousSidTotal: null,
            reportedChange: 0,
          },
        ],
        actualChange: 1000000,
        asOfDate: '2026-06-30',
        currentPercent: 41.12,
        currentTotalShares: 3201000000,
        investorStatus: 'L',
        issuerName: 'ADARO ANDALAN INDONESIA Tbk, PT',
        kind: 'shareholder' as const,
        previousDate: '2026-06-29',
        previousPercent: 41.1,
        previousTotalShares: 3200000000,
        reportedChange: 1000000,
        shareholderName: 'ADARO STRATEGIC INVESTMENTS',
        sourceDate: '2026-06-30',
        ticker: 'AADI',
      },
    ];

    const collapsedMarkup = renderToStaticMarkup(<FivePctOwnershipTable rows={rows} />);
    expect(collapsedMarkup).toContain('Account count');
    expect(collapsedMarkup).toContain('ADARO STRATEGIC INVESTMENTS');
    expect(collapsedMarkup).toContain('<colgroup>');
    expect(collapsedMarkup).not.toContain('BOS LTD S/A PT ADARO STRATEGIC INVESTMENTS');

    const expandedMarkup = renderToStaticMarkup(
      <FivePctOwnershipTable
        initialExpandedIds={['shareholder:AADI:ADARO STRATEGIC INVESTMENTS']}
        rows={rows}
      />,
    );
    expect(expandedMarkup).toContain('shareholder-name shareholder-name-changed');
    expect(expandedMarkup).toContain('Broker');
    expect(expandedMarkup).toContain('AZ');
    expect(expandedMarkup).toContain('Nama Pemegang Rekening Efek');
    expect(expandedMarkup).toContain('Nama Rekening Efek');
    expect(expandedMarkup).toContain('CITIBANK, N. A');
    expect(expandedMarkup).toContain('BOS LTD S/A PT ADARO STRATEGIC INVESTMENTS');
    expect(expandedMarkup).toContain('69,000,000');
    expect(expandedMarkup).toContain('41.12%');
    expect(expandedMarkup).not.toContain('SID total');
  });

  it('renders a 5% ownership date selector with latest and historical dates', () => {
    const markup = renderToStaticMarkup(
      <FivePctDateSelector
        dates={['2026-06-30', '2026-06-28']}
        onDateChange={() => undefined}
        selectedDate=""
      />,
    );

    expect(markup).toContain('Date');
    expect(markup).toContain('Latest');
    expect(markup).toContain('2026-06-30');
    expect(markup).toContain('2026-06-28');
  });

  it('renders a reusable snapshot date selector for daily price snapshots', () => {
    const markup = renderToStaticMarkup(
      <SnapshotDateSelector
        dates={['2026-07-01', '2026-06-28']}
        isLoading={false}
        onDateChange={() => undefined}
        selectedDate="2026-06-28"
      />,
    );

    expect(markup).toContain('Date');
    expect(markup).toContain('Latest');
    expect(markup).toContain('2026-07-01');
    expect(markup).toContain('2026-06-28');
    expect(markup).toContain('selected=""');
  });

  it('renders a daily price sort selector for server-ranked movement views', () => {
    const markup = renderToStaticMarkup(
      <DailyPriceSortSelector onSortChange={() => undefined} selectedSort="price1dDesc" />,
    );

    expect(markup).toContain('Sort');
    expect(markup).toContain('Ticker A-Z');
    expect(markup).toContain('%1d price high');
    expect(markup).toContain('%1d volume high');
    expect(markup).toContain('%3d volume high');
    expect(markup).toContain('selected=""');
  });

  it('renders daily prices with snapshot movement columns', () => {
    const markup = renderToStaticMarkup(<DailyPricesTable rows={[]} />);

    expect(markup).toContain('Ticker');
    expect(markup).toContain('Name');
    expect(markup).toContain('Price');
    expect(markup).toContain('%1d price');
    expect(markup).toContain('%1d volume');
    expect(markup).toContain('%3d volume');
    expect(markup).not.toContain('Prev');
    expect(markup).not.toContain('Open');
    expect(markup).not.toContain('High');
    expect(markup).not.toContain('Low');
    expect(markup).not.toContain('Close');
    expect(markup).not.toContain('Value');
  });

  it('softly colors daily price movement cells by direction', () => {
    const markup = renderToStaticMarkup(
      <DailyPricesTable
        rows={[
          {
            close: 100,
            foreignBuy: null,
            foreignSell: null,
            frequency: null,
            high: 100,
            listedShares: null,
            low: 100,
            name: 'Direction Test Tbk.',
            open: 100,
            previous: 100,
            price: 100,
            price1dChangePercent: 1.5,
            ticker: 'MOVE',
            tradeDate: '2026-07-01',
            tradeableShares: null,
            value: null,
            volume: 1000,
            volume1dChangePercent: -2.25,
            volume3dChangePercent: 0,
          },
        ]}
      />,
    );

    expect(markup).toContain('movement-positive');
    expect(markup).toContain('movement-negative');
    expect(markup).toContain('1.50%');
    expect(markup).toContain('-2.25%');
    expect(markup).toContain('0.00%');
    expect(markup).not.toContain('movement-neutral');
  });

  it('keeps the previous paginated result while an uncached page loads', () => {
    const previousResult = {
      latestDate: '2026-06-30',
      page: 1,
      pageSize: 50,
      rows: [{ ticker: 'AADI' }],
      total: 51,
    };

    expect(keepPreviousListResult(previousResult)).toBe(previousResult);
    expect(keepPreviousListResult(undefined)).toBeUndefined();
  });

  it('lets daily prices use a compact 10 ticker page size without changing the shared default', () => {
    expect(createListFilters().pageSize).toBe(50);
    expect(createListFilters({ tradeDate: '' }, { pageSize: 10 })).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 10,
        q: '',
        ticker: '',
        tradeDate: '',
      }),
    );
  });

  it('derives the next daily prices page for prefetching until the final page', () => {
    const filters = createListFilters({ tradeDate: '2026-07-01' }, { pageSize: 10 });

    expect(nextPageFilters(filters, 959)).toEqual(
      expect.objectContaining({
        page: 2,
        pageSize: 10,
        q: '',
        ticker: '',
        tradeDate: '2026-07-01',
      }),
    );
    expect(nextPageFilters({ ...filters, page: 96 }, 959)).toBeNull();
  });

  it('derives up to five upcoming daily prices pages for prefetching', () => {
    const filters = createListFilters({ tradeDate: '2026-07-01' }, { pageSize: 10 });

    expect(dailyPricesPrefetchPages).toBe(5);
    expect(
      prefetchPageFilters(filters, 959, dailyPricesPrefetchPages).map(
        (pageFilters) => pageFilters.page,
      ),
    ).toEqual([2, 3, 4, 5, 6]);
    expect(
      prefetchPageFilters({ ...filters, page: 2 }, 959, dailyPricesPrefetchPages).map(
        (pageFilters) => pageFilters.page,
      ),
    ).toEqual([3, 4, 5, 6, 7]);
    expect(
      prefetchPageFilters({ ...filters, page: 94 }, 959, dailyPricesPrefetchPages).map(
        (pageFilters) => pageFilters.page,
      ),
    ).toEqual([95, 96]);
    expect(prefetchPageFilters({ ...filters, page: 96 }, 959, dailyPricesPrefetchPages)).toEqual(
      [],
    );
  });

  it('prefetches upcoming pages sequentially instead of bursting concurrent requests', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await prefetchSequentially([{ page: 2 }, { page: 3 }, { page: 4 }], async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });

    expect(maxInFlight).toBe(1);
  });

  it('maps left and right arrow hotkeys to bounded pagination changes', () => {
    expect(pageFromPaginationHotkey({ key: 'ArrowRight', targetTagName: 'BODY' }, 1, 3)).toBe(2);
    expect(pageFromPaginationHotkey({ key: 'ArrowLeft', targetTagName: 'BODY' }, 2, 3)).toBe(1);
    expect(pageFromPaginationHotkey({ key: 'ArrowLeft', targetTagName: 'BODY' }, 1, 3)).toBeNull();
    expect(pageFromPaginationHotkey({ key: 'ArrowRight', targetTagName: 'BODY' }, 3, 3)).toBeNull();
    expect(
      pageFromPaginationHotkey({ key: 'ArrowRight', targetTagName: 'INPUT' }, 1, 3),
    ).toBeNull();
    expect(
      pageFromPaginationHotkey(
        { key: 'ArrowRight', targetIsContentEditable: true, targetTagName: 'DIV' },
        1,
        3,
      ),
    ).toBeNull();
    expect(pageFromPaginationHotkey({ key: 'x', targetTagName: 'BODY' }, 1, 3)).toBeNull();
  });

  it('maps up and down arrow hotkeys to bounded row highlight changes', () => {
    expect(rowIndexFromKeyboard({ key: 'ArrowDown', targetTagName: 'BODY' }, null, 3)).toBe(0);
    expect(rowIndexFromKeyboard({ key: 'ArrowDown', targetTagName: 'BODY' }, 0, 3)).toBe(1);
    expect(rowIndexFromKeyboard({ key: 'ArrowDown', targetTagName: 'BODY' }, 2, 3)).toBe(2);
    expect(rowIndexFromKeyboard({ key: 'ArrowUp', targetTagName: 'BODY' }, null, 3)).toBe(2);
    expect(rowIndexFromKeyboard({ key: 'ArrowUp', targetTagName: 'BODY' }, 2, 3)).toBe(1);
    expect(rowIndexFromKeyboard({ key: 'ArrowUp', targetTagName: 'BODY' }, 0, 3)).toBe(0);
    expect(rowIndexFromKeyboard({ key: 'ArrowDown', targetTagName: 'INPUT' }, null, 3)).toBeNull();
    expect(
      rowIndexFromKeyboard(
        { key: 'ArrowDown', targetIsContentEditable: true, targetTagName: 'DIV' },
        null,
        3,
      ),
    ).toBeNull();
    expect(rowIndexFromKeyboard({ key: 'ArrowDown', targetTagName: 'BODY' }, null, 0)).toBeNull();
    expect(rowIndexFromKeyboard({ key: 'x', targetTagName: 'BODY' }, null, 3)).toBeNull();
  });

  it('lets account detail table scroll gestures chain back to the page', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const accountDetailRule = css.match(/\.account-detail-panel\s*\{[^}]+\}/)?.[0] ?? '';

    expect(accountDetailRule).toContain('overflow: auto');
    expect(accountDetailRule).not.toContain('overscroll-behavior: contain');
  });
});
