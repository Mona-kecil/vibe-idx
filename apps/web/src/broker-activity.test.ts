import { describe, expect, it } from 'vite-plus/test';
import { ledgerPositions, net, sessionLines, sessionPositions } from './broker-activity';
import type { BrokerLedger, BrokerSession } from './brokers';

const ledger: BrokerLedger = {
  broker: 'HP',
  days: [
    {
      date: '2026-11-10',
      board: 'regular',
      ticker: ['BBCA', 'SINI'],
      buy_value: [100, 50],
      buy_shares: [10, 5],
      sell_value: [0, 80],
      sell_shares: [0, 8],
    },
    {
      date: '2026-11-10',
      board: 'negotiation',
      ticker: ['BBCA'],
      buy_value: [0],
      buy_shares: [0],
      sell_value: [500],
      sell_shares: [50],
    },
    {
      date: '2026-11-09',
      board: 'regular',
      ticker: ['SINI'],
      buy_value: [40],
      buy_shares: [4],
      sell_value: [0],
      sell_shares: [0],
    },
  ],
};
const session: BrokerSession = {
  date: '2026-11-10',
  broker: 'HP',
  minute: [32400, 32400, 32460, 32460],
  board: ['RG', 'RG', 'RG', 'NG'],
  ticker: ['BBCA', 'SINI', 'BBCA', 'BBCA'],
  buy_value: [100, 0, 50, 0],
  buy_shares: [100, 0, 50, 0],
  sell_value: [0, 30, 20, 500],
  sell_shares: [0, 300, 20, 500],
};

describe('broker activity', () => {
  it('sums each ticker over the chosen sessions and board', () => {
    const regular = ledgerPositions(ledger, new Set(['2026-11-09', '2026-11-10']), 'regular');
    expect(regular.map((p) => [p.ticker, net(p, 'VALUE')])).toEqual([
      ['BBCA', 100],
      ['SINI', 10],
    ]);
    const all = ledgerPositions(ledger, new Set(['2026-11-10']), 'all');
    expect(all.map((p) => [p.ticker, net(p, 'VALUE')])).toEqual([
      ['BBCA', -400],
      ['SINI', -30],
    ]);
  });

  it('sums a session from running trade and lines each ticker up from the open', () => {
    expect(sessionPositions(session, 'regular').map((p) => [p.ticker, net(p, 'LOT')])).toEqual([
      ['BBCA', 1.3],
      ['SINI', -3],
    ]);
    const lines = sessionLines(session, 'regular', 'VALUE', ['BBCA', 'SINI']);
    const at = (clock: string) => Date.parse(`2026-11-10T${clock}Z`) / 1000;
    expect(lines).toEqual([
      {
        ticker: 'BBCA',
        points: [
          { time: at('09:00:00'), value: 100 },
          { time: at('09:01:00'), value: 130 },
        ],
      },
      {
        ticker: 'SINI',
        points: [
          { time: at('09:00:00'), value: -30 },
          { time: at('09:01:00'), value: -30 },
        ],
      },
    ]);
  });
});
