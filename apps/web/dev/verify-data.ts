import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { brokerHistorySchema } from '../src/brokers.js';
import { corporateActionsSchema, tickerSchema } from '../src/data.js';
import { tickBookSchema, tickTradesSchema } from '../src/ticks.js';
import { cliErrors, plural } from '../../pipeline/dev/cli.js';
import { table } from './format.js';
import { fixtureState, fixturesRoot, localBrokerApi } from './local-api.js';

// The terminal's panes import their CSS, which only the bundler can load.
registerHooks({
  load: (url, context, next) =>
    url.endsWith('.css')
      ? { format: 'module', source: '', shortCircuit: true }
      : next(url, context),
});
const { checks, noTrades, skipLine } = await import('./checks.js');
type Check = (typeof checks)[number];
type Outcome = ReturnType<Extract<Check, { session: unknown }>['session']>;

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
        const session = {
          ticker,
          date,
          asOf,
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
      ...Object.entries(r.skips).map(([reason, where]) => skipLine(reason, where, show)),
    ];
    if (!lines.length || !show) continue;
    console.log(`\n${r.name}`);
    for (const line of lines.slice(0, show)) console.log(`  ${line}`);
    if (lines.length > show) console.log(`  ${lines.length - show} more, --show N for more`);
  }
}
if (!compared) console.error('\nNothing was compared. Check the tickers, dates and checks given.');
