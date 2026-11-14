import { describe, expect, it } from 'vite-plus/test';
import { distribution, distributionLayout, others } from './broker-distribution';
import type { TickTrades } from './ticks';

const session = (
  fills: [buyer: string, seller: string, shares: number, price: number, board?: string][],
): TickTrades => ({
  date: '2026-11-10',
  ticker: 'SINI',
  time: fills.map(() => 32400),
  price: fills.map((f) => f[3]),
  shares: fills.map((f) => f[2]),
  side: fills.map(() => 'b'),
  auction: fills.map(() => false),
  board: fills.map((f) => f[4] ?? 'RG'),
  buyer: fills.map((f) => f[0]),
  buyer_foreign: fills.map(() => false),
  seller: fills.map((f) => f[1]),
  seller_foreign: fills.map(() => false),
  buy_order: fills.map((_, i) => i),
  sell_order: fills.map((_, i) => i),
});

describe('broker distribution', () => {
  const day = session([
    ['AA', 'XX', 100, 10],
    ['AA', 'YY', 300, 10],
    ['BB', 'XX', 200, 10],
    ['CC', 'ZZ', 50, 10],
    ['AA', 'XX', 1000, 10, 'NG'],
  ]);

  it('links each buyer to the sellers it bought from on the board, summed across sessions', () => {
    const result = distribution([day, day], 'regular', 'VALUE');
    expect(result.total).toBe(13000);
    expect(result.buyers).toEqual([
      { code: 'AA', amount: 8000 },
      { code: 'BB', amount: 4000 },
      { code: 'CC', amount: 1000 },
    ]);
    expect(result.sellers[0]).toEqual({ code: 'XX', amount: 6000 });
    expect(result.links).toContainEqual({ buyer: 'AA', seller: 'YY', amount: 6000 });
  });

  it('folds brokers past the top into one Others node per side', () => {
    const result = distribution([day], 'all', 'LOT', 1);
    expect(result.buyers).toEqual([
      { code: 'AA', amount: 14 },
      { code: others, amount: 2.5 },
    ]);
    expect(result.sellers).toEqual([
      { code: 'XX', amount: 13 },
      { code: others, amount: 3.5 },
    ]);
    expect(result.links).toContainEqual({ buyer: others, seller: others, amount: 0.5 });
    expect(result.links.reduce((sum, link) => sum + link.amount, 0)).toBe(result.total);
  });

  it('fills every node with its links and keeps nodes inside the height', () => {
    const result = distribution([day], 'regular', 'VALUE');
    const view = distributionLayout(result, 300);
    for (const [side, own] of [
      [view.left, 'buyer'],
      [view.right, 'seller'],
    ] as const)
      for (const [code, box] of side) {
        const parts = view.bands.filter((band) => band[own] === code);
        const filled = parts.reduce(
          (sum, band) => sum + (own === 'buyer' ? band.from.h : band.to.h),
          0,
        );
        expect(filled).toBeCloseTo(box.h);
        expect(box.y + box.h).toBeLessThanOrEqual(300 + 1e-9);
      }
  });
});
