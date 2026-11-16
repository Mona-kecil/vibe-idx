import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { aggregateBrokers } from '../src/broker-data.js';
import {
  brokerBoards,
  brokerHistorySchema,
  type BrokerBoard,
  type BrokerDay,
  type InvestorFilter,
} from '../src/brokers.js';
import {
  corporateActionSchema,
  corporateActionsSchema,
  tickerSchema,
  type Ticker,
} from '../src/data.js';
import {
  bars,
  tickBookSchema,
  tickTradesSchema,
  type TickBook,
  type TickTrades,
} from '../src/ticks.js';
import { cliErrors, plural } from '../../pipeline/dev/cli.js';
import { money, table } from './format.js';
import { fixtureState, fixturesRoot, localBrokerApi } from './local-api.js';

// The terminal's panes import their CSS, which only the bundler can load.
registerHooks({
  load: (url, context, next) =>
    url.endsWith('.css')
      ? { format: 'module', source: '', shortCircuit: true }
      : next(url, context),
});
const { cumulativeFlows, foreignFlow } = await import('../src/terminal/BrokerPanes.js');

cliErrors();
const usage = `pnpm verify:data [TICKER]... [--dates <date|from..to|all>] [--check <name>]... [--show N] [--json]

Checks that views built from different sources agree on the fixtures, through the app's own API and functions.
The as-of session and every ticker by default. Exits 1 when a check fails or nothing was compared. A note is a
difference with a known cause, and a skip says why a check didn't apply, such as a session without an order book.
--show N lists up to N failures, notes and skips per check, 5 by default. --json prints only JSON on stdout.`;
const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dates: { type: 'string' },
    check: { type: 'string', multiple: true, default: [] },
    show: { type: 'string', default: '5' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

type CorporateAction = z.infer<typeof corporateActionSchema>;
/** One ticker's data on one session, as the app loads it. */
type Session = {
  ticker: string;
  date: string;
  trades: TickTrades;
  book: TickBook | undefined;
  brokers: BrokerDay[];
  /** Undefined when the ticker has no price history, such as a warrant. */
  prices: Ticker['prices'] | undefined;
  actions: CorporateAction[];
};
/** A ticker's whole broker history, for checks over a period rather than a session. */
type History = { brokers: BrokerDay[] };
/**
 * A mismatch as one line, or a difference with a known cause as a note. No mismatch passes, and a skip says why
 * the check doesn't apply.
 */
type Finding = string | { note: string };
type Outcome = Finding[] | { skip: string };
type Check =
  | { name: string; title: string; session: (s: Session) => Outcome }
  | { name: string; title: string; history: (h: History) => Outcome };

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
      action.steps.some((step) => step.step === 'ex' && step.date > s.date && step.date <= asOf),
  );
}

const noTrades = (ticker: string, date: string) => ({
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

const checks: Check[] = [
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
];

if (args.help) {
  console.log(`${usage}\n\n${checks.map((c) => `${c.name.padEnd(10)} ${c.title}`).join('\n')}`);
  process.exit(0);
}
const unknown = args.check.filter((name) => !checks.some((c) => c.name === name));
if (unknown.length)
  throw new Error(
    `Unknown check ${unknown.join(', ')}. Checks: ${checks.map((c) => c.name).join(', ')}`,
  );
const chosen = checks.filter((c) => !args.check.length || args.check.includes(c.name));
const show = z.coerce.number().int().nonnegative().parse(args.show);
/** A short list of skipped places is shown whole; a long one, such as every warrant, up to --show. */
const listed = (where: string[]) => (where.length <= 12 ? where.length : Math.max(show, 1));

const state = await fixtureState();
const asOf = state.asOf;
const actions = corporateActionsSchema.parse(
  JSON.parse(await readFile(join(fixturesRoot, 'public/corporate-actions.json'), 'utf8')),
);
const dates = (() => {
  if (args.dates === 'all') return state.sessions;
  const [from, to = from] = z
    .tuple([z.iso.date(), z.iso.date().optional()])
    .parse((args.dates ?? state.asOf).split('..'));
  const picked = state.sessions.filter((date) => date >= from && date <= to);
  if (!picked.length)
    throw new Error(`No fixture session in ${args.dates}. Sessions: ${state.sessions.join(' ')}`);
  return picked;
})();
const ticks = join(fixturesRoot, 'bucket/site/ticks');
const tickers = positionals.length
  ? positionals
      .filter((arg) => arg !== '--')
      .map((t) =>
        z
          .string()
          .regex(/^[A-Z0-9-]{1,12}$/)
          .parse(t.toUpperCase()),
      )
  : [
      ...new Set([
        ...(await readdir(ticks)),
        ...(await readdir(join(fixturesRoot, 'public/ticker'))).map((file) =>
          file.replace(/\.json$/, ''),
        ),
      ]),
    ].sort();

const api = await localBrokerApi();
const publicTicker = async (ticker: string) => {
  const file = join(fixturesRoot, 'public/ticker', `${ticker}.json`);
  return existsSync(file)
    ? tickerSchema.parse(JSON.parse(await readFile(file, 'utf8')))
    : undefined;
};

const tally = new Map(
  chosen.map((c) => [
    c.name,
    {
      passed: 0,
      failed: 0,
      skipped: 0,
      failures: [] as string[],
      notes: [] as string[],
      /** Where each reason applied. */
      skips: {} as Record<string, string[]>,
    },
  ]),
);
const record = (check: Check, where: string, outcome: Outcome) => {
  const t = tally.get(check.name)!;
  if ('skip' in outcome) {
    t.skipped++;
    (t.skips[outcome.skip] ??= []).push(where);
    return;
  }
  const failures = outcome.filter((f) => typeof f === 'string');
  t.notes.push(...outcome.flatMap((f) => (typeof f === 'string' ? [] : [`${where} ${f.note}`])));
  if (failures.length) {
    t.failed++;
    t.failures.push(...failures.map((line) => `${where} ${line}`));
  } else t.passed++;
};

const started = performance.now();
let sessions = 0;
const found = new Set<string>();
const queue = [...tickers];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (let ticker = queue.shift(); ticker; ticker = queue.shift()) {
      const body = await api.json(`ticker=${ticker}`);
      const brokers = body ? brokerHistorySchema.parse(body).days : [];
      if (brokers.length) found.add(ticker);
      for (const check of chosen)
        if ('history' in check)
          record(
            check,
            ticker,
            brokers.length ? check.history({ brokers }) : { skip: 'no broker data' },
          );
      if (!chosen.some((check) => 'session' in check)) continue;
      const prices = (await publicTicker(ticker))?.prices;
      for (const date of dates) {
        const raw = await api.json(`view=ticks&ticker=${ticker}&date=${date}&kind=trades`);
        // A session without a running trade file still runs, as no trades, so broker data or prices for it fail.
        if (raw) {
          sessions++;
          found.add(ticker);
        }
        const book = await api.json(`view=ticks&ticker=${ticker}&date=${date}&kind=book`);
        const session: Session = {
          ticker,
          date,
          trades: tickTradesSchema.parse(raw ?? noTrades(ticker, date)),
          book: book ? tickBookSchema.parse(book) : undefined,
          brokers,
          prices,
          actions: actions.filter((action) => action.ticker === ticker),
        };
        for (const check of chosen)
          if ('session' in check) record(check, `${ticker} ${date}`, check.session(session));
      }
    }
  }),
);

const unknownTickers = positionals.length ? tickers.filter((t) => !found.has(t)) : [];
if (unknownTickers.length)
  throw new Error(
    `No broker data or running trade for ${unknownTickers.join(', ')} in the fixtures.`,
  );
const results = chosen.map((c) => ({ name: c.name, title: c.title, ...tally.get(c.name)! }));
const compared = results.some((r) => r.passed || r.failed);
process.exitCode = results.some((r) => r.failed) || !compared ? 1 : 0;
if (args.json) {
  console.log(JSON.stringify({ dates, tickers: tickers.length, sessions, results }, null, 2));
} else {
  const span = dates.length === 1 ? dates[0] : `${dates[0]} to ${dates.at(-1)}`;
  console.log(
    `${span}, ${plural(tickers.length, 'ticker')}, ${plural(sessions, 'session')}, ${((performance.now() - started) / 1000).toFixed(1)}s\n`,
  );
  table(
    results.map((r) => [
      r.failed ? 'FAIL' : r.passed ? 'PASS' : 'NONE',
      r.name,
      r.passed,
      r.failed,
      r.notes.length,
      r.skipped,
      // What a PASS covers: the comparisons made out of all there were to make.
      `${(r.passed + r.failed).toLocaleString('en')} of ${(r.passed + r.failed + r.skipped).toLocaleString('en')}`,
      r.title,
    ]),
    ['', 'check', 'pass', 'fail', 'note', 'skip', 'compared', ''],
    'llrrrrrl',
  );
  for (const r of results) {
    const lines = [
      ...r.failures,
      ...r.notes.map((note) => `note: ${note}`),
      ...Object.entries(r.skips).map(
        ([reason, where]) =>
          `skip: ${reason}, ${plural(where.length, 'time')}: ${where.slice(0, listed(where)).join(', ')}${where.length > listed(where) ? `, and ${where.length - listed(where)} more` : ''}`,
      ),
    ];
    if (!lines.length || !show) continue;
    console.log(`\n${r.name}`);
    for (const line of lines.slice(0, show)) console.log(`  ${line}`);
    if (lines.length > show) console.log(`  ${lines.length - show} more, --show N for more`);
  }
}
if (!compared) console.error('\nNothing was compared. Check the tickers, dates and checks given.');
