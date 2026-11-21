import { describe, expect, it } from 'vite-plus/test';
import { doneDetail } from '../ticks';
import { seconds, tradeSession, type Fill } from '../test-builders';
import {
  activeCount,
  blockMatches,
  emptyFilter,
  parseClock,
  setBroker,
  tradeMatches,
  type TradeFilter,
} from './trade-filter';

const filtered = (patch: Partial<TradeFilter>): TradeFilter => ({ ...emptyFilter, ...patch });
const brokers = (buyer: string, seller: string, join: 'OR' | 'AND' = 'OR') =>
  filtered({ brokers: { buyer, seller, join } });

/** The fills of a session that pass, by index. */
function fills(list: Fill[], filter: TradeFilter) {
  const trades = tradeSession(list);
  return list.flatMap((_, i) => (tradeMatches(trades, i, filter) ? [i] : []));
}
/** The blocks of a session that pass, by the broker that placed each. */
function blocks(list: Fill[], filter: TradeFilter) {
  return doneDetail(tradeSession(list))
    .filter((block) => blockMatches(block, filter))
    .map((block) => block.broker);
}

describe('action', () => {
  const list: Fill[] = [
    { side: 'b' },
    { side: 's' },
    { side: 'b', board: 'NG' },
    { side: 's', board: 'TN' },
  ];
  it('keeps only regular-board fills of that aggressor side', () => {
    expect(fills(list, filtered({ action: 'BUY' }))).toEqual([0]);
    expect(fills(list, filtered({ action: 'SELL' }))).toEqual([1]);
    expect(fills(list, emptyFilter)).toEqual([0, 1, 2, 3]);
  });
  it('keeps only regular-board blocks of that aggressor side', () => {
    const rows: Fill[] = [
      { side: 'b', buyer: 'B1' },
      { side: 's', seller: 'S1' },
      { board: 'NG', buyer: 'N1', seller: 'N2' },
    ];
    expect(blocks(rows, filtered({ action: 'BUY' }))).toEqual(['B1']);
    expect(blocks(rows, filtered({ action: 'SELL' }))).toEqual(['S1']);
    expect(blocks(rows, emptyFilter)).toHaveLength(3);
  });
});

describe('board', () => {
  const list: Fill[] = [{ board: 'RG' }, { board: 'NG' }, { board: 'TN' }];
  it('keeps one board of fills', () => {
    expect(fills(list, filtered({ board: 'RG' }))).toEqual([0]);
    expect(fills(list, filtered({ board: 'NG' }))).toEqual([1]);
    expect(fills(list, filtered({ board: 'TN' }))).toEqual([2]);
  });
  it('keeps one board of blocks, including off-board trades', () => {
    expect(blocks(list, filtered({ board: 'RG' }))).toHaveLength(1);
    expect(blocks(list, filtered({ board: 'NG' }))).toHaveLength(1);
    expect(blocks(list, filtered({ board: 'TN' }))).toHaveLength(1);
  });
});

describe('investor', () => {
  const list: Fill[] = [
    { buyerForeign: true, sellerForeign: false },
    { buyerForeign: false, sellerForeign: true },
    { buyerForeign: false, sellerForeign: false },
    { buyerForeign: true, sellerForeign: true },
  ];
  it('matches the origin of the buying or selling client of a fill', () => {
    expect(fills(list, filtered({ investor: 'F BUY' }))).toEqual([0, 3]);
    expect(fills(list, filtered({ investor: 'F SELL' }))).toEqual([1, 3]);
    expect(fills(list, filtered({ investor: 'D BUY' }))).toEqual([1, 2]);
    expect(fills(list, filtered({ investor: 'D SELL' }))).toEqual([0, 2]);
  });
  it('matches a block side when any party on it has that origin', () => {
    // One aggressive buy order filled by a foreign and a domestic seller.
    const mixed: Fill[] = [
      { buyOrder: 1, sellOrder: 10, buyer: 'AA', seller: 'FS', sellerForeign: true },
      { buyOrder: 1, sellOrder: 11, buyer: 'AA', seller: 'DS' },
      { buyOrder: 2, sellOrder: 12, buyer: 'CC', seller: 'DS' },
    ];
    expect(blocks(mixed, filtered({ investor: 'F SELL' }))).toEqual(['AA']);
    expect(blocks(mixed, filtered({ investor: 'D SELL' }))).toEqual(['AA', 'CC']);
    expect(blocks(mixed, filtered({ investor: 'F BUY' }))).toEqual([]);
    expect(blocks(mixed, filtered({ investor: 'D BUY' }))).toEqual(['AA', 'CC']);
  });
  it('reads the buyer and seller of an off-board trade', () => {
    const off: Fill[] = [{ board: 'NG', buyer: 'AA', buyerForeign: true, seller: 'BB' }];
    expect(blocks(off, filtered({ investor: 'F BUY' }))).toEqual(['BB']);
    expect(blocks(off, filtered({ investor: 'D BUY' }))).toEqual([]);
    expect(blocks(off, filtered({ investor: 'D SELL' }))).toEqual(['BB']);
  });
});

describe('price', () => {
  const list: Fill[] = [{ price: 100 }, { price: 150 }, { price: 200 }];
  it('is inclusive at both ends of a fill price', () => {
    expect(fills(list, filtered({ price: { min: 150, max: null } }))).toEqual([1, 2]);
    expect(fills(list, filtered({ price: { min: null, max: 150 } }))).toEqual([0, 1]);
    expect(fills(list, filtered({ price: { min: 150, max: 150 } }))).toEqual([1]);
  });
  it('compares a block by the price its row shows', () => {
    // 100 and 200 at equal size make a block that shows 150.
    const one: Fill[] = [
      { buyOrder: 1, sellOrder: 10, price: 100 },
      { buyOrder: 1, sellOrder: 11, price: 200 },
    ];
    expect(blocks(one, filtered({ price: { min: 150, max: 150 } }))).toHaveLength(1);
    expect(blocks(one, filtered({ price: { min: 151, max: null } }))).toHaveLength(0);
    expect(blocks(one, filtered({ price: { min: null, max: 149 } }))).toHaveLength(0);
  });
});

describe('time', () => {
  const list: Fill[] = [{ time: '09:00:00' }, { time: '09:30:00' }, { time: '10:00:00' }];
  it('is inclusive at both ends of a fill time', () => {
    expect(fills(list, filtered({ time: { from: seconds('09:30:00'), to: null } }))).toEqual([
      1, 2,
    ]);
    expect(fills(list, filtered({ time: { from: null, to: seconds('09:30:00') } }))).toEqual([
      0, 1,
    ]);
    expect(
      fills(list, filtered({ time: { from: seconds('09:30:00'), to: seconds('09:30:00') } })),
    ).toEqual([1]);
  });
  it('compares a block by its start', () => {
    const one: Fill[] = [
      { buyOrder: 1, sellOrder: 10, time: '09:00:00' },
      { buyOrder: 1, sellOrder: 11, time: '09:45:00' },
      { buyOrder: 2, sellOrder: 12, time: '09:30:00', buyer: 'LATE' },
    ];
    expect(blocks(one, filtered({ time: { from: seconds('09:10:00'), to: null } }))).toEqual([
      'LATE',
    ]);
    expect(blocks(one, filtered({ time: { from: null, to: seconds('09:00:00') } }))).toEqual([
      'AA',
    ]);
  });
});

describe('brokers', () => {
  const list: Fill[] = [
    { buyer: 'XL', seller: 'YP' },
    { buyer: 'YP', seller: 'XL' },
    { buyer: 'AA', seller: 'BB' },
    { buyer: 'XL', seller: 'XL' },
  ];
  it('ignores both empty fields', () => {
    expect(fills(list, brokers('', ''))).toEqual([0, 1, 2, 3]);
  });
  it('matches the buyer only on the buy side and the seller only on the sell side', () => {
    expect(fills(list, brokers('XL', ''))).toEqual([0, 3]);
    expect(fills(list, brokers('', 'XL'))).toEqual([1, 3]);
    expect(fills(list, brokers('XL', '', 'AND'))).toEqual([0, 3]);
  });
  it('joins two set fields by either side with OR', () => {
    expect(fills(list, brokers('XL', 'YP'))).toEqual([0, 3]);
    expect(fills(list, brokers('YP', 'XL'))).toEqual([1, 3]);
    expect(fills(list, brokers('AA', 'XL'))).toEqual([1, 2, 3]);
  });
  it('requires both sides with AND', () => {
    expect(fills(list, brokers('XL', 'YP', 'AND'))).toEqual([0]);
    expect(fills(list, brokers('XL', 'XL', 'AND'))).toEqual([3]);
  });
  it('matches any broker on a block side', () => {
    const one: Fill[] = [
      { buyOrder: 1, sellOrder: 10, buyer: 'AA', seller: 'S1' },
      { buyOrder: 1, sellOrder: 11, buyer: 'AA', seller: 'S2' },
    ];
    expect(blocks(one, brokers('AA', ''))).toEqual(['AA']);
    expect(blocks(one, brokers('', 'S2'))).toEqual(['AA']);
    expect(blocks(one, brokers('S2', ''))).toEqual([]);
    expect(blocks(one, brokers('AA', 'S2', 'AND'))).toEqual(['AA']);
    expect(blocks(one, brokers('AA', 'S3', 'AND'))).toEqual([]);
    expect(blocks(one, brokers('AA', 'S3', 'OR'))).toEqual(['AA']);
  });
  it('reads the buyer and seller of an off-board trade', () => {
    const off: Fill[] = [{ board: 'NG', buyer: 'AA', seller: 'BB' }];
    expect(blocks(off, brokers('AA', 'BB', 'AND'))).toEqual(['BB']);
    expect(blocks(off, brokers('BB', '', 'OR'))).toEqual([]);
    expect(blocks(off, brokers('', 'BB'))).toEqual(['BB']);
  });
});

describe('dimensions together', () => {
  it('require every set dimension', () => {
    const list: Fill[] = [
      { price: 100, buyer: 'XL', buyerForeign: true },
      { price: 200, buyer: 'XL', buyerForeign: true },
      { price: 100, buyer: 'XL' },
    ];
    expect(
      fills(
        list,
        filtered({
          investor: 'F BUY',
          price: { min: null, max: 150 },
          brokers: { buyer: 'XL', seller: '', join: 'OR' },
        }),
      ),
    ).toEqual([0]);
  });
});

describe('activeCount', () => {
  it('counts each set dimension once and leaves action out', () => {
    expect(activeCount(emptyFilter)).toBe(0);
    expect(activeCount(filtered({ action: 'BUY' }))).toBe(0);
    expect(
      activeCount(
        filtered({
          board: 'NG',
          investor: 'F BUY',
          price: { min: 100, max: 200 },
          time: { from: 0, to: null },
          brokers: { buyer: 'XL', seller: 'YP', join: 'AND' },
        }),
      ),
    ).toBe(5);
    expect(activeCount(filtered({ price: { min: null, max: 200 } }))).toBe(1);
  });
});

describe('setBroker', () => {
  const none = emptyFilter.brokers;
  it('fills the seller from the buyer while the seller is empty', () => {
    expect(setBroker(none, 'buyer', 'X')).toEqual({ ...none, buyer: 'X', seller: 'X' });
  });
  it('keeps following while the seller equals the old buyer', () => {
    let state = setBroker(none, 'buyer', 'X');
    state = setBroker(state, 'buyer', 'XL');
    expect(state).toEqual({ ...none, buyer: 'XL', seller: 'XL' });
    state = setBroker(state, 'buyer', '');
    expect(state).toEqual(none);
  });
  it('unlinks once the seller is edited to something else', () => {
    let state = setBroker(none, 'buyer', 'XL');
    state = setBroker(state, 'seller', 'YP');
    expect(state).toEqual({ ...none, buyer: 'XL', seller: 'YP' });
    state = setBroker(state, 'buyer', 'AA');
    expect(state).toEqual({ ...none, buyer: 'AA', seller: 'YP' });
  });
  it('leaves the buyer alone when only the seller is typed', () => {
    expect(setBroker(none, 'seller', 'Y')).toEqual({ ...none, seller: 'Y' });
  });
  it('keeps the join', () => {
    expect(setBroker({ ...none, join: 'AND' }, 'buyer', 'X').join).toBe('AND');
  });
});

describe('parseClock', () => {
  it('reads colon and plain forms', () => {
    expect(parseClock('9:30')).toBe(seconds('09:30:00'));
    expect(parseClock('09:30')).toBe(seconds('09:30:00'));
    expect(parseClock('0930')).toBe(seconds('09:30:00'));
    expect(parseClock(' 16:15 ')).toBe(seconds('16:15:00'));
    expect(parseClock('09:30:15')).toBe(seconds('09:30:15'));
  });
  it('lets an end time without seconds cover its whole minute', () => {
    expect(parseClock('10:00', true)).toBe(seconds('10:00:59'));
    expect(parseClock('1000', true)).toBe(seconds('10:00:59'));
    expect(parseClock('10:00:30', true)).toBe(seconds('10:00:30'));
  });
  it('rejects anything else', () => {
    for (const text of ['', '9', '930', '24:00', '09:60', '9:3', 'ab:cd', '09-30', '1:2:3'])
      expect(parseClock(text), text).toBeNull();
  });
});
