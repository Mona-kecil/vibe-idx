import type { UTCTimestamp } from 'lightweight-charts';
import type { BrokerBoard, BrokerLedger, BrokerSession } from './brokers.js';
import directory from './broker-directory.json';
import { boardCodes } from './ticks.js';

export type Position = {
  ticker: string;
  buyValue: number;
  buyShares: number;
  sellValue: number;
  sellShares: number;
};
type Columns = Pick<
  BrokerSession,
  'ticker' | 'buy_value' | 'buy_shares' | 'sell_value' | 'sell_shares'
>;

function add(totals: Map<string, Position>, columns: Columns, i: number) {
  const ticker = columns.ticker[i]!;
  const position = totals.get(ticker) ?? {
    ticker,
    buyValue: 0,
    buyShares: 0,
    sellValue: 0,
    sellShares: 0,
  };
  position.buyValue += columns.buy_value[i]!;
  position.buyShares += columns.buy_shares[i]!;
  position.sellValue += columns.sell_value[i]!;
  position.sellShares += columns.sell_shares[i]!;
  totals.set(ticker, position);
}

/** The broker's buying and selling per ticker over the given sessions on one board. */
export function ledgerPositions(
  ledger: BrokerLedger,
  dates: Set<string>,
  board: BrokerBoard | 'all',
): Position[] {
  const totals = new Map<string, Position>();
  for (const day of ledger.days)
    if (dates.has(day.date) && (board === 'all' || day.board === board))
      day.ticker.forEach((_, i) => add(totals, day, i));
  return [...totals.values()];
}

/** The same totals for one session, from running trade. */
export function sessionPositions(session: BrokerSession, board: BrokerBoard | 'all') {
  const totals = new Map<string, Position>();
  session.ticker.forEach((_, i) => {
    if (board === 'all' || session.board[i] === boardCodes[board]) add(totals, session, i);
  });
  return [...totals.values()];
}

export const net = (position: Position, unit: 'VALUE' | 'LOT') =>
  unit === 'LOT'
    ? (position.buyShares - position.sellShares) / 100
    : position.buyValue - position.sellValue;

/**
 * Each ticker's net buying summed from the open, one point per minute the broker traded. Times are
 * the Jakarta clock written as UTC, so the chart's own axis labels read in Jakarta time.
 */
export function sessionLines(
  session: BrokerSession,
  board: BrokerBoard | 'all',
  unit: 'VALUE' | 'LOT',
  tickers: string[],
) {
  const midnight = Date.parse(`${session.date}T00:00:00Z`) / 1000;
  const wanted = new Set(tickers);
  const minutes = [
    ...new Set(
      session.minute.filter((_, i) => board === 'all' || session.board[i] === boardCodes[board]),
    ),
  ].sort((a, b) => a - b);
  const steps = new Map(tickers.map((ticker) => [ticker, new Map<number, number>()]));
  session.ticker.forEach((ticker, i) => {
    if (!wanted.has(ticker) || (board !== 'all' && session.board[i] !== boardCodes[board])) return;
    const step = steps.get(ticker)!;
    const minute = session.minute[i]!;
    step.set(
      minute,
      (step.get(minute) ?? 0) +
        (unit === 'LOT'
          ? (session.buy_shares[i]! - session.sell_shares[i]!) / 100
          : session.buy_value[i]! - session.sell_value[i]!),
    );
  });
  return tickers.map((ticker) => {
    let sum = 0;
    const step = steps.get(ticker)!;
    return {
      ticker,
      points: minutes.map((minute) => ({
        time: (midnight + minute) as UTCTimestamp,
        value: (sum += step.get(minute) ?? 0),
      })),
    };
  });
}

// Revoked codes still name past trades, but nobody picks them for today's activity.
const brokers = Object.entries(directory.brokers)
  .filter(([, row]) => !('historicalOnly' in row))
  .map(([code, row]) => ({ code, name: row.name.replace(/^PT /, '').replace(/ Tbk\.?$/, '') }))
  .sort((a, b) => a.code.localeCompare(b.code));
// Nearly every name has these, so matching them would list every broker.
const common = new Set(['SEKURITAS', 'SECURITIES', 'INDONESIA']);
const words = new Map(
  brokers.map((b) => [
    b.code,
    b.name
      .toUpperCase()
      .split(' ')
      .filter((word) => !common.has(word)),
  ]),
);

/** Code prefixes first, then, from two letters, names with a word starting with the text. */
export function matchBrokers(text: string, limit = 8) {
  const query = text.trim().toUpperCase();
  if (!query) return brokers.slice(0, limit);
  const named = (code: string) =>
    query.length > 1 && words.get(code)!.some((word) => word.startsWith(query));
  return [
    ...brokers.filter((b) => b.code.startsWith(query)),
    ...brokers.filter((b) => !b.code.startsWith(query) && named(b.code)),
  ].slice(0, limit);
}
