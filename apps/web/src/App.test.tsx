import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vite-plus/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { parseFivePct, deriveFivePct } from '../convex/lib/fivePct';
import { parsePrices } from '../convex/lib/prices';
import {
  App,
  DailyPricesTable,
  FivePctOwnershipTable,
  pageFromPaginationHotkey,
  rowIndexFromKeyboard,
} from './App';

describe('Convex market UI', () => {
  it('keeps ownership deep links and removes the unsupported insiders surface', async () => {
    const client = new ConvexReactClient('http://127.0.0.1:3210');
    try {
      const markup = renderToStaticMarkup(
        <ConvexProvider client={client}>
          <App initialUrl="/ownership/5pct" />
        </ConvexProvider>,
      );
      expect(markup).toContain('<h2 id="surface-title">5% Ownership</h2>');
      expect(markup).toContain('Daily Prices');
      expect(markup).toContain('1% Ownership');
      expect(markup).not.toContain('Insider');
      expect(markup).not.toContain('SQLite');
      const missing = renderToStaticMarkup(
        <ConvexProvider client={client}>
          <App initialUrl="/insiders" />
        </ConvexProvider>,
      );
      expect(missing).toContain('Page not found');
    } finally {
      await client.close();
    }
  });

  it('renders source price values and combined ownership changes without inventing v1 fields', () => {
    const prices = parsePrices(
      JSON.parse(
        readFileSync(
          new URL('../convex/fixtures/stock-summary-idxid.json', import.meta.url),
          'utf8',
        ),
      ),
    );
    const priceMarkup = renderToStaticMarkup(<DailyPricesTable rows={prices.slice(0, 1)} />);
    expect(priceMarkup).toContain('AADI');
    expect(priceMarkup).toContain('10,950');
    expect(priceMarkup).toContain('7.62%');
    expect(priceMarkup).not.toContain('%3d volume');
    const five = parseFivePct(
      readFileSync(new URL('../convex/fixtures/ownership-5pct-2026-10-19.xlsx', import.meta.url)),
    );
    const changes = deriveFivePct(five, [])
      .changes.slice(0, 1)
      .map((row) => ({ ...row, _id: 'change' }));
    expect(changes).toHaveLength(1);
    const markup = renderToStaticMarkup(
      <FivePctOwnershipTable initialExpandedIds={['change']} rows={changes} />,
    );
    expect(markup).toContain(changes[0]!.investorName);
    expect(markup).toContain(new Intl.NumberFormat('en-US').format(changes[0]!.previousCombined));
    expect(markup).toContain(new Intl.NumberFormat('en-US').format(changes[0]!.currentCombined));
    expect(markup).toContain('Previous shares');
    expect(markup).toContain('Share delta');
    expect(markup).toContain('Nama Rekening Efek');
    expect(markup).not.toContain('SID total');
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
});
