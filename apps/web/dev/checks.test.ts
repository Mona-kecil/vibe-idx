import { describe, expect, it } from 'vite-plus/test';
import type { BrokerDay } from '../src/brokers';
import type { Ticker } from '../src/data';
import { brokerRow, tradeSession, type Fill } from '../src/test-builders';
import type { ArchiveArticle } from '../../feeds/src/contracts';
import {
  checks,
  noTrades,
  skipLine,
  type CorporateAction,
  type NewsView,
  type Session,
} from './checks';

const date = '2026-11-10';

/** Running trade and broker data that agree: AA buys 300 shares at 100 from BB, a foreign client on the buy side. */
const fills: Fill[] = [
  { buyer: 'AA', seller: 'BB', shares: 100, price: 100, buyerForeign: true },
  { buyer: 'AA', seller: 'BB', shares: 200, price: 100, buyerForeign: true },
];
const day = (buy: BrokerDay['buy'], sell: BrokerDay['sell']): BrokerDay => ({
  date,
  board: 'regular',
  buy,
  sell,
});
const agreeing = day(
  [brokerRow('AA', 300, 30_000, { investor: 'foreign' })],
  [brokerRow('BB', 300, 30_000)],
);
const price = (fields: Partial<Ticker['prices'][number]> = {}): Ticker['prices'][number] => ({
  date,
  open: 100,
  high: 100,
  low: 100,
  close: 100,
  volume: 300,
  value: 30_000,
  net_foreign: 0,
  ...fields,
});

function session(fields: Partial<Session> = {}): Session {
  return {
    ticker: 'BBCA',
    date,
    asOf: date,
    trades: tradeSession(fills, { date }),
    book: undefined,
    brokers: [agreeing],
    prices: [price()],
    actions: [],
    ...fields,
  };
}

const run = (name: string, s: Session) => {
  const check = checks.find((c) => c.name === name)!;
  if (!('session' in check)) throw new Error(`${name} is a history check`);
  return check.session(s);
};
const failures = (outcome: ReturnType<typeof run>) =>
  'skip' in outcome ? [] : outcome.filter((f) => typeof f === 'string');

describe('brk-rt', () => {
  it('passes when broker data nets to what running trade traded', () => {
    expect(run('brk-rt', session())).toEqual([]);
  });

  it('fails naming the broker whose net differs', () => {
    const off = day([brokerRow('AA', 400, 40_000)], [brokerRow('BB', 300, 30_000)]);
    const found = failures(run('brk-rt', session({ brokers: [off] })));
    expect(found.join(' ')).toMatch(/AA/);
  });

  it('fails when running trade has a board that broker data lacks', () => {
    expect(failures(run('brk-rt', session({ brokers: [] }))).join(' ')).toMatch(
      /RT has 2 trades, BRK has none/,
    );
  });

  it('skips a session with neither source', () => {
    expect(run('brk-rt', session({ brokers: [], trades: noTrades('BBCA', date) }))).toEqual({
      skip: 'no broker data or running trade',
    });
  });

  it('passes as a note when broker data restates lots after a bonus issue', () => {
    const bonus: CorporateAction = {
      ticker: 'BBCA',
      kind: 'BONUS',
      label: 'Bonus shares',
      amount: null,
      steps: [{ step: 'ex', date: '2026-11-12' }],
    };
    // Twice the shares at the same values, as broker data shows them once the bonus doubles the count.
    const restated = day(
      [brokerRow('AA', 600, 30_000, { investor: 'foreign' })],
      [brokerRow('BB', 600, 30_000)],
    );
    const outcome = run(
      'brk-rt',
      session({ brokers: [restated], actions: [bonus], asOf: '2026-11-13' }),
    );
    expect(outcome).toEqual([{ note: expect.stringMatching(/restated by 2\.0000/) }]);
  });
});

describe('ff-rt', () => {
  it('passes when foreign flow matches running trade foreign clients', () => {
    expect(run('ff-rt', session())).toEqual([]);
  });

  it('fails when broker data marks a different client as foreign', () => {
    const domestic = day([brokerRow('AA', 300, 30_000)], [brokerRow('BB', 300, 30_000)]);
    expect(failures(run('ff-rt', session({ brokers: [domestic] })))).toHaveLength(1);
  });
});

describe('prices-rt', () => {
  it('passes when the daily row matches running trade', () => {
    expect(run('prices-rt', session())).toEqual([]);
  });

  it('fails when the close differs', () => {
    expect(
      failures(run('prices-rt', session({ prices: [price({ close: 105 })] }))).join(' '),
    ).toMatch(/close/);
  });

  it('skips a ticker without daily prices, such as a warrant', () => {
    expect(run('prices-rt', session({ prices: undefined }))).toEqual({
      skip: 'no daily prices, as for a warrant',
    });
  });
});

describe('ob-prices', () => {
  const book = (close: number | null) => ({ date, ticker: 'BBCA', close, bid: [], offer: [] });

  it('passes when the order book closes at the daily close', () => {
    expect(run('ob-prices', session({ book: book(100) }))).toEqual([]);
  });

  it('fails when it closes elsewhere', () => {
    expect(failures(run('ob-prices', session({ book: book(95) })))).toHaveLength(1);
  });

  it('says why it skipped', () => {
    expect(run('ob-prices', session())).toEqual({ skip: 'no order book in the fixtures' });
    expect(run('ob-prices', session({ book: book(null) }))).toEqual({
      skip: 'the order book has no close',
    });
  });
});

describe('bfl-brk', () => {
  it('passes when the flow ends where broker data nets', () => {
    const check = checks.find((c) => c.name === 'bfl-brk')!;
    if (!('history' in check)) throw new Error('bfl-brk is a history check');
    expect(check.history({ brokers: [agreeing] })).toEqual([]);
  });
});

const article = (fields: Partial<ArchiveArticle> = {}): ArchiveArticle => ({
  ts: '2026-11-10T03:00:00.000Z',
  src: 'Kontan',
  title: 'Saham BBCA Menguat',
  link: 'https://news.example.test/a',
  tags: ['BBCA'],
  source_id: 'kontan',
  ...fields,
});
const row = (a: ArchiveArticle) => ({
  title: a.title,
  url: a.link,
  published_at: a.ts,
  source: a.src,
});
const runNews = (name: string, n: Partial<NewsView>) => {
  const check = checks.find((c) => c.name === name)!;
  if (!('news' in check)) throw new Error(`${name} is not a news check`);
  return check.news({ ticker: 'BBCA', articles: [], index: undefined, ...n });
};

describe('news-index', () => {
  const a = article();
  it('passes when the file lists the tagged articles', () => {
    expect(
      runNews('news-index', { articles: [{ article: a, expected: ['BBCA'] }], index: [row(a)] }),
    ).toEqual([]);
    expect(
      runNews('news-index', {
        articles: [{ article: a, expected: ['BBCA'] }],
        index: [row({ ...a, link: 'http://www.news.example.test/a/' })],
      }),
    ).toEqual([]);
  });
  it('names an article the file lacks, one it should not hold, and one that differs', () => {
    const other = article({
      title: 'Saham BBRI',
      link: 'https://news.example.test/b',
      tags: ['BBRI'],
    });
    expect(
      runNews('news-index', { articles: [{ article: a, expected: ['BBCA'] }], index: [] }),
    ).toHaveLength(1);
    expect(
      runNews('news-index', {
        articles: [{ article: a, expected: ['BBCA'] }],
        index: [row(a), row(other)],
      }),
    ).toHaveLength(1);
    expect(
      runNews('news-index', {
        articles: [{ article: a, expected: ['BBCA'] }],
        index: [{ ...row(a), source: 'Antara' }],
      }),
    ).toHaveLength(1);
  });
  it('skips a ticker with no news', () => {
    expect(runNews('news-index', {})).toEqual({ skip: 'no archived news' });
  });
});

describe('news-tags', () => {
  it('fails an article the tagger now tags but the archive does not, and the reverse for Google', () => {
    const missed = article({ tags: [] });
    expect(
      runNews('news-tags', { articles: [{ article: missed, expected: ['BBCA'] }] }),
    ).toHaveLength(1);
    const stale = article({ source_id: 'google-news', tags: ['BBCA'] });
    expect(runNews('news-tags', { articles: [{ article: stale, expected: [] }] })).toHaveLength(1);
  });
  it('passes a feed tag the title does not show, as a note', () => {
    const outcome = runNews('news-tags', { articles: [{ article: article(), expected: [] }] });
    expect(outcome).toEqual([{ note: '1 article tagged from a summary' }]);
  });
  it('passes when archive and tagger agree', () => {
    expect(
      runNews('news-tags', { articles: [{ article: article(), expected: ['BBCA'] }] }),
    ).toEqual([]);
  });
});

describe('skipLine', () => {
  it('lists a short list whole, whatever --show says', () => {
    const where = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(skipLine('no order book', where, 2)).toBe(
      'skip: no order book, 6 times: a, b, c, d, e, f',
    );
  });

  it('cuts a long list at --show', () => {
    const where = Array.from({ length: 20 }, (_, i) => `t${i}`);
    expect(skipLine('no daily prices', where, 3)).toBe(
      'skip: no daily prices, 20 times: t0, t1, t2, and 17 more',
    );
  });
});
