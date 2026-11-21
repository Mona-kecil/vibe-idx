/**
 * The checks `pnpm verify:data` runs: each compares two views of one ticker's data and says whether they agree. They
 * take plain data, so a test can feed them a session built by hand.
 */
import { z } from 'zod';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { aggregateBrokers } from '../src/broker-data.js';
import { distribution } from '../src/broker-distribution.js';
import {
  brokerBoards,
  type BrokerBoard,
  type BrokerDay,
  type InvestorFilter,
} from '../src/brokers.js';
import { corporateActionSchema, type Ticker } from '../src/data.js';
import { canonicalLink } from '../../feeds/src/archive.js';
import { tickerNewsSchema, type ArchiveArticle } from '../../feeds/src/contracts.js';
import { cumulativeFlows, foreignFlow } from '../src/terminal/BrokerPanes.js';
import {
  bars,
  clock,
  sessionBars,
  sessionStart,
  unpackBars,
  type BarFile,
  type TickBook,
  type TickTrades,
} from '../src/ticks.js';
import { plural } from '../../pipeline/dev/cli.js';
import { money } from './format.js';

export type CorporateAction = z.infer<typeof corporateActionSchema>;
/** One ticker's data on one session, as the app loads it. */
export type Session = {
  ticker: string;
  date: string;
  /** The last fixture session, which broker data is restated up to. */
  asOf: string;
  trades: TickTrades;
  /** The ticker's published bar file, covering every collected session. */
  bars: BarFile | undefined;
  book: TickBook | undefined;
  brokers: BrokerDay[];
  /** Undefined when the ticker has no price history, such as a warrant. */
  prices: Ticker['prices'] | undefined;
  actions: CorporateAction[];
};
/** A ticker's whole broker history, for checks over a period rather than a session. */
export type History = { brokers: BrokerDay[] };
/**
 * A mismatch as one line, or a difference with a known cause as a note. No mismatch passes, and a skip says why
 * the check doesn't apply.
 */
export type Finding = string | { note: string };
export type Outcome = Finding[] | { skip: string };
/**
 * One ticker's archived news: the articles tagged with it, or that the current tagger would tag with it, each with the
 * tags the tagger gives its title now, and the ticker news file `/api/news` serves.
 */
export type NewsView = {
  ticker: string;
  articles: { article: ArchiveArticle; expected: string[] }[];
  index: { title: string; url: string; published_at: string; source: string }[] | undefined;
};
export type Check =
  | { name: string; title: string; session: (s: Session) => Outcome }
  | { name: string; title: string; history: (h: History) => Outcome }
  | { name: string; title: string; news: (n: NewsView) => Outcome };

const boardCode = { regular: 'RG', negotiation: 'NG', cash: 'TN' } as const satisfies Record<
  BrokerBoard,
  string
>;
/** Rupiah values are whole numbers, so anything beyond float noise is a real difference. */
const same = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(a) * 1e-12);

/** Running trade on one board, per broker and for foreign clients. */
function tradeTotals(trades: TickTrades, board: string) {
  const brokers = new Map<string, { value: number; shares: number }>();
  let value = 0,
    shares = 0,
    count = 0,
    foreign = 0;
  const add = (code: string, sign: number, amount: number, shares: number) => {
    const total = brokers.get(code) ?? { value: 0, shares: 0 };
    total.value += sign * amount;
    total.shares += sign * shares;
    brokers.set(code, total);
  };
  trades.time.forEach((_, i) => {
    if (trades.board[i] !== board) return;
    const traded = trades.shares[i]!,
      amount = trades.price[i]! * traded;
    count++;
    value += amount;
    shares += traded;
    add(trades.buyer[i]!, 1, amount, traded);
    add(trades.seller[i]!, -1, amount, traded);
    if (trades.buyer_foreign[i]) foreign += amount;
    if (trades.seller_foreign[i]) foreign -= amount;
  });
  return { brokers, value, shares, count, foreign };
}

/** Lists the first few differences of a keyed comparison, plus how many more there are. */
function differences(
  label: string,
  pairs: [key: string, a: number, b: number][],
  names: [string, string],
  format = money,
): string[] {
  const off = pairs.filter(([, a, b]) => !same(a, b));
  if (!off.length) return [];
  const shown = off
    .slice(0, 3)
    .map(([key, a, b]) => `${key} ${names[0]} ${format(a)} ${names[1]} ${format(b)}`)
    .join(', ');
  return [`${label}: ${shown}${off.length > 3 ? `, ${off.length - 3} more` : ''}`];
}
const lots = (shares: number) => `${money(shares / 100)} lot`;

/** Broker data restates lots before an action that changes the share count; running trade keeps them as traded. */
const shareActions = new Set<CorporateAction['kind']>(['BONUS', 'RIGHTS', 'SPLIT']);
function restatedBy(s: Session) {
  return s.actions.find(
    (action) =>
      shareActions.has(action.kind) &&
      action.steps.some((step) => step.step === 'ex' && step.date > s.date && step.date <= s.asOf),
  );
}

export const noTrades = (ticker: string, date: string) => ({
  ticker,
  date,
  time: [],
  price: [],
  shares: [],
  side: [],
  auction: [],
  board: [],
  buyer: [],
  buyer_foreign: [],
  seller: [],
  seller_foreign: [],
  buy_order: [],
  sell_order: [],
});

/** Every board where broker data or running trade has something, with both sides of it. */
function boards(s: Session) {
  return brokerBoards
    .map((board) => ({
      board,
      days: s.brokers.filter((day) => day.date === s.date && day.board === board),
      rt: tradeTotals(s.trades, boardCode[board]),
    }))
    .filter(({ days, rt }) => days.length || rt.count);
}

export const checks: Check[] = [
  {
    name: 'brk-rt',
    title: 'BRK net by broker matches RT',
    session: (s) => {
      const active = boards(s);
      if (!active.length) return { skip: 'no broker data or running trade' };
      return active.flatMap(({ board, days, rt }) => {
        if (!days.length) return [`${board}: RT has ${rt.count} trades, BRK has none`];
        if (!rt.count) return [`${board}: BRK has trading, RT has no trades`];
        const brk = new Map(aggregateBrokers(days).map((b) => [b.code, b]));
        const codes = [...new Set([...brk.keys(), ...rt.brokers.keys()])].sort();
        const netShares = (factor: number) =>
          codes.map((code): [string, number, number] => {
            const b = brk.get(code);
            return [code, b ? b.buy - b.sell : 0, (rt.brokers.get(code)?.shares ?? 0) * factor];
          });
        let shares: Finding[] = differences(`${board} net`, netShares(1), ['BRK', 'RT'], lots);
        const action = shares.length ? restatedBy(s) : undefined;
        if (action) {
          // The restatement scales every broker by one factor, so the check still holds after scaling.
          const factor = [...brk.values()].reduce((sum, b) => sum + b.buy, 0) / rt.shares;
          const scaled = differences(`${board} net`, netShares(factor), ['BRK', 'RT'], lots);
          shares = scaled.length
            ? scaled
            : [
                {
                  note: `${board} lots restated by ${factor.toFixed(4)} for ${action.label.toLowerCase()} ${action.steps.find((step) => step.step === 'ex')!.date}`,
                },
              ];
        }
        return [
          ...differences(
            `${board} net value`,
            codes.map((code): [string, number, number] => {
              const b = brk.get(code);
              return [code, b ? b.buyValue - b.sellValue : 0, rt.brokers.get(code)?.value ?? 0];
            }),
            ['BRK', 'RT'],
          ),
          ...shares,
          ...differences(
            `${board} value`,
            [
              [
                'all brokers',
                days.reduce((sum, d) => sum + d.buy.reduce((v, r) => v + r.value, 0), 0),
                rt.value,
              ],
            ],
            ['BRK', 'RT'],
          ),
        ];
      });
    },
  },
  {
    name: 'bd-brk',
    title: 'BD net value by broker matches BRK',
    // A board that only one source has fails brk-rt; here it has nothing to compare.
    session: (s) => {
      const withBrokers = boards(s).filter(({ days, rt }) => days.length && rt.count);
      if (!withBrokers.length) return { skip: 'no board with both broker data and running trade' };
      return withBrokers.flatMap(({ board, days }) => {
        // Every broker keeps its own node, so none is folded into Others.
        const chart = distribution([s.trades], board, 'VALUE', Infinity);
        const bd = new Map<string, number>();
        for (const { code, amount } of chart.buyers) bd.set(code, (bd.get(code) ?? 0) + amount);
        for (const { code, amount } of chart.sellers) bd.set(code, (bd.get(code) ?? 0) - amount);
        const brk = new Map(aggregateBrokers(days).map((b) => [b.code, b.buyValue - b.sellValue]));
        const codes = [...new Set([...brk.keys(), ...bd.keys()])].sort();
        return differences(
          `${board} net value`,
          codes.map((code): [string, number, number] => [
            code,
            bd.get(code) ?? 0,
            brk.get(code) ?? 0,
          ]),
          ['BD', 'BRK'],
        );
      });
    },
  },
  {
    name: 'ff-rt',
    title: 'FF net matches RT foreign clients',
    // A board that only one source has fails brk-rt; here it has nothing to compare.
    session: (s) => {
      const withBrokers = boards(s).filter(({ days, rt }) => days.length && rt.count);
      if (!withBrokers.length) return { skip: 'no board with both broker data and running trade' };
      return withBrokers.flatMap(({ board, days, rt }) =>
        differences(
          board,
          [['net', foreignFlow(days, [s.date], 'VALUE')[0]!.net, rt.foreign]],
          ['FF', 'RT'],
        ),
      );
    },
  },
  {
    name: 'prices-rt',
    title: 'Daily prices match RT on the regular board',
    session: (s) => {
      if (!s.prices) return { skip: 'no daily prices, as for a warrant' };
      // A day without trades still has a price row, carrying the last close.
      const price = s.prices.find((p) => p.date === s.date && p.volume > 0);
      const [day] = bars(s.trades, 24 * 60);
      if (!price || !day)
        return price || day
          ? [`only ${price ? 'prices' : 'RT'} has the session`]
          : { skip: 'no trades' };
      // IDX leaves open, high and low out on some days.
      const optional = (key: string, a: number | null, b: number): [string, number, number][] =>
        a == null ? [] : [[key, a, b]];
      return differences(
        'session',
        [
          ...optional('open', price.open, day.open),
          ...optional('high', price.high, day.high),
          ...optional('low', price.low, day.low),
          ['close', price.close, day.close],
          ['volume', price.volume, day.shares],
          ['value', price.value, tradeTotals(s.trades, 'RG').value],
        ],
        ['prices', 'RT'],
      );
    },
  },
  {
    name: 'bars-rt',
    title: 'Published 15-minute bars match RT on the regular board',
    session: (s) => {
      const expected = sessionBars(s.trades);
      const start = sessionStart(s.date);
      const published = (s.bars ? unpackBars(s.bars) : []).filter(
        (bar) => bar.time >= start && bar.time < start + 86400,
      );
      if (!expected.length && !published.length) return { skip: 'no regular-board trades' };
      const fields = [
        'open',
        'high',
        'low',
        'close',
        'shares',
        'value',
        'foreignBuy',
        'foreignSell',
      ] as const;
      const at = (time: number) => clock(time - start).slice(0, 5);
      const times = (rows: typeof expected) => new Set(rows.map((bar) => bar.time));
      const absent = (from: Set<number>, rows: typeof expected) =>
        rows.filter((bar) => !from.has(bar.time)).map((bar) => at(bar.time));
      const missing = absent(times(published), expected);
      const extra = absent(times(expected), published);
      const list = (label: string, found: string[]) =>
        found.length
          ? [`bars: ${plural(found.length, 'bar')} ${label}: ${found.slice(0, 3).join(', ')}`]
          : [];
      return [
        ...list('missing from the file', missing),
        ...list('in the file without RT', extra),
        ...differences(
          'bars',
          expected.flatMap((b) => {
            const a = published.find((bar) => bar.time === b.time);
            return a
              ? fields.map((field): [string, number, number] => [
                  `${at(b.time)} ${field}`,
                  a[field],
                  b[field],
                ])
              : [];
          }),
          ['published', 'RT'],
        ),
      ];
    },
  },
  {
    name: 'ob-prices',
    title: 'OB close matches the daily close',
    session: (s) => {
      const price = s.prices?.find((p) => p.date === s.date);
      if (!s.book) return { skip: 'no order book in the fixtures' };
      if (s.book.close == null) return { skip: 'the order book has no close' };
      if (!price) return { skip: 'no daily price for the session' };
      return differences('close', [['close', s.book.close, price.close]], ['OB', 'prices']);
    },
  },
  {
    name: 'bfl-brk',
    title: 'BFL end matches BRK net over the year, once per ticker',
    history: (h) =>
      brokerBoards.flatMap((board) => {
        const days = h.brokers.filter((day) => day.board === board);
        const dates = [...new Set(days.map((day) => day.date))].sort();
        if (!dates.length) return [];
        return (['ALL', 'FOREIGN', 'DOMESTIC'] as InvestorFilter[]).flatMap((investor) => {
          const brk = new Map(
            aggregateBrokers(days, investor).map((b) => [b.code, b.buyValue - b.sellValue]),
          );
          const flows = cumulativeFlows(days, dates, 'VALUE', investor);
          return differences(
            `${board} ${investor.toLowerCase()}`,
            [...new Set([...brk.keys(), ...flows.map((f) => f.code)])].map((code) => [
              code,
              flows.find((f) => f.code === code)?.points.at(-1)?.value ?? 0,
              brk.get(code) ?? 0,
            ]),
            ['BFL', 'BRK'],
          );
        });
      }),
  },
  {
    name: 'news-index',
    title: 'The ticker news file lists the archived articles tagged with the ticker',
    news: (n) => {
      const archived = new Map(
        n.articles
          .filter(({ article }) => article.tags.includes(n.ticker))
          .map(({ article }) => [canonicalLink(article.link), article]),
      );
      if (!archived.size && !n.index?.length) return { skip: 'no archived news' };
      const listed = new Map((n.index ?? []).map((row) => [canonicalLink(row.url), row]));
      return [
        ...[...archived]
          .filter(([key]) => !listed.has(key))
          .map(([, a]) => `archived but not in the news file: ${a.title}`),
        ...[...listed]
          .filter(([key]) => !archived.has(key))
          .map(([, row]) => `in the news file but not archived with this tag: ${row.title}`),
        ...[...archived].flatMap(([key, a]) => {
          const row = listed.get(key);
          return row && (row.title !== a.title || row.published_at !== a.ts || row.source !== a.src)
            ? [`news file row differs from the archive: ${a.title}`]
            : [];
        }),
      ];
    },
  },
  {
    name: 'news-tags',
    title: 'Archived tags agree with what the tagger finds in the title now',
    news: (n) => {
      const mismatches: Finding[] = [];
      let fromSummary = 0;
      for (const { article, expected } of n.articles) {
        const stored = article.tags.includes(n.ticker);
        const found = expected.includes(n.ticker);
        if (stored === found) continue;
        // A feed article was also tagged from a summary the archive does not keep.
        if (stored && article.source_id !== 'google-news') fromSummary++;
        else
          mismatches.push(
            `${article.title} (${article.source_id}) is ${stored ? 'tagged' : 'not tagged'}, the tagger says ${found ? 'tag' : 'no tag'}`,
          );
      }
      if (!n.articles.length) return { skip: 'no archived news' };
      return [
        ...mismatches,
        ...(fromSummary
          ? [{ note: `${plural(fromSummary, 'article')} tagged from a summary` }]
          : []),
      ];
    },
  },
];

/** A skip reason with where it applied: a short list whole, a long one, such as every warrant, up to `show`. */
export function skipLine(reason: string, where: string[], show: number) {
  const listed = where.length <= 12 ? where.length : Math.max(show, 1);
  return `skip: ${reason}, ${plural(where.length, 'time')}: ${where.slice(0, listed).join(', ')}${where.length > listed ? `, and ${where.length - listed} more` : ''}`;
}

/** All annual ticker files, matching the monthly archive's full history. */
export async function readNewsIndex(newsRoot: string, ticker: string) {
  const directory = join(newsRoot, 'ticker', ticker);
  const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return (
    await Promise.all(
      files
        .filter((file) => /^\d{4}\.json$/.test(file))
        .map(
          async (file) =>
            tickerNewsSchema.parse(JSON.parse(await readFile(join(directory, file), 'utf8'))).news,
        ),
    )
  ).flat();
}
