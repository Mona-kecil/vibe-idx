import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vite-plus/test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  App,
  FivePctDateSelector,
  FivePctOwnershipTable,
  keepPreviousListResult,
  renderAppTitle,
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
        accountCount: 2,
        accounts: [
          {
            id: 'account-a',
            accountHolderName: 'CITIBANK, N. A',
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

  it('lets account detail table scroll gestures chain back to the page', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const accountDetailRule = css.match(/\.account-detail-panel\s*\{[^}]+\}/)?.[0] ?? '';

    expect(accountDetailRule).toContain('overflow: auto');
    expect(accountDetailRule).not.toContain('overscroll-behavior: contain');
  });
});
