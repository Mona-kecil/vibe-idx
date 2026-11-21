import { sideParties, type Block, type TickTrades } from '../ticks.js';

export const actions = ['ALL', 'BUY', 'SELL'] as const;
export const boards = ['ALL', 'RG', 'NG', 'TN'] as const;
export const investors = ['ALL', 'F BUY', 'F SELL', 'D BUY', 'D SELL'] as const;
export const joins = ['OR', 'AND'] as const;

export type Brokers = { buyer: string; seller: string; join: (typeof joins)[number] };
export type TradeFilter = {
  /** BUY and SELL keep only regular-board trades and blocks of that aggressor side. */
  action: (typeof actions)[number];
  board: (typeof boards)[number];
  /** The origin of the client that bought or sold. */
  investor: (typeof investors)[number];
  /** Inclusive. */
  price: { min: number | null; max: number | null };
  /** Seconds since midnight, inclusive. */
  time: { from: number | null; to: number | null };
  brokers: Brokers;
};

export const emptyFilter: TradeFilter = {
  action: 'ALL',
  board: 'ALL',
  investor: 'ALL',
  price: { min: null, max: null },
  time: { from: null, to: null },
  brokers: { buyer: '', seller: '', join: 'OR' },
};

/** How many of board, investor, price, time and brokers are set. Action stays inline, so it is not counted. */
export function activeCount(filter: TradeFilter): number {
  return [
    filter.board !== 'ALL',
    filter.investor !== 'ALL',
    filter.price.min !== null || filter.price.max !== null,
    filter.time.from !== null || filter.time.to !== null,
    filter.brokers.buyer !== '' || filter.brokers.seller !== '',
  ].filter(Boolean).length;
}

type Side = { brokers: readonly string[]; foreign: boolean; domestic: boolean };
const fillSide = (broker: string, foreign: boolean): Side => ({
  brokers: [broker],
  foreign,
  domestic: !foreign,
});

function sidesMatch(filter: TradeFilter, buy: Side, sell: Side): boolean {
  switch (filter.investor) {
    case 'F BUY':
      if (!buy.foreign) return false;
      break;
    case 'F SELL':
      if (!sell.foreign) return false;
      break;
    case 'D BUY':
      if (!buy.domestic) return false;
      break;
    case 'D SELL':
      if (!sell.domestic) return false;
      break;
  }
  const { buyer, seller, join } = filter.brokers;
  if (!buyer && !seller) return true;
  const boughtBy = buyer !== '' && buy.brokers.includes(buyer);
  const soldBy = seller !== '' && sell.brokers.includes(seller);
  return join === 'OR' ? boughtBy || soldBy : (!buyer || boughtBy) && (!seller || soldBy);
}

function inRange(value: number, min: number | null, max: number | null) {
  return (min === null || value >= min) && (max === null || value <= max);
}

export function tradeMatches(trades: TickTrades, i: number, filter: TradeFilter): boolean {
  const board = trades.board[i]!;
  if (filter.action !== 'ALL') {
    if (board !== 'RG' || trades.side[i] !== (filter.action === 'BUY' ? 'b' : 's')) return false;
  }
  if (filter.board !== 'ALL' && board !== filter.board) return false;
  if (!inRange(trades.price[i]!, filter.price.min, filter.price.max)) return false;
  if (!inRange(trades.time[i]!, filter.time.from, filter.time.to)) return false;
  return sidesMatch(
    filter,
    fillSide(trades.buyer[i]!, trades.buyer_foreign[i]!),
    fillSide(trades.seller[i]!, trades.seller_foreign[i]!),
  );
}

export function blockMatches(block: Block, filter: TradeFilter): boolean {
  if (filter.action !== 'ALL' && block.side !== filter.action.toLowerCase()) return false;
  if (filter.board !== 'ALL' && block.board !== filter.board) return false;
  // The price a DD row shows.
  if (!inRange(block.value / block.shares, filter.price.min, filter.price.max)) return false;
  if (!inRange(block.start, filter.time.from, filter.time.to)) return false;
  return sidesMatch(filter, sideParties(block, 'buy'), sideParties(block, 'sell'));
}

/**
 * A code typed into the buyer field fills the seller field while the seller is empty or still equal to the buyer's
 * old value, so one code filters both sides. Editing the seller never changes the buyer, which is how the two
 * unlink: a symmetric rule would drag the buyer along with every seller edit and they could never differ.
 */
export function setBroker(brokers: Brokers, side: 'buyer' | 'seller', code: string): Brokers {
  if (side === 'seller') return { ...brokers, seller: code };
  const linked = brokers.seller === '' || brokers.seller === brokers.buyer;
  return { ...brokers, buyer: code, seller: linked ? code : brokers.seller };
}

/**
 * `9:30`, `09:30`, `09:30:15`, `0930` or `093015` as seconds since midnight, or null. An `end` time without seconds
 * covers its whole minute.
 */
export function parseClock(text: string, end = false): number | null {
  const trimmed = text.trim();
  const parts =
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed) ?? /^(\d{2})(\d{2})(\d{2})?$/.exec(trimmed);
  if (!parts) return null;
  const hours = Number(parts[1]),
    minutes = Number(parts[2]),
    seconds = Number(parts[3] ?? 0);
  if (hours >= 24 || minutes >= 60 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds + (end && parts[3] === undefined ? 59 : 0);
}
