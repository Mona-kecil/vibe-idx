import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { aggregateBrokers, brokerName } from '../src/broker-data.js';
import { brokerBoards, brokerHistorySchema } from '../src/brokers.js';
import { clock, tickTradesSchema } from '../src/ticks.js';
import { cliErrors } from '../../pipeline/dev/cli.js';
import { money, table } from './format.js';
import { fixtureState, fixturesRoot, localBrokerApi } from './local-api.js';

const usage = `pnpm inspect                       fixture dates and contents
pnpm inspect brk <TICKER> [dates]   broker summary: net buyers and sellers (BRK)
pnpm inspect rt <TICKER> [date]     one session of running trade

dates: one session (2026-11-13) or a range (2026-11-03..2026-11-13), the as-of session by default
--board regular|negotiation|cash|all (default regular), --top N (default 8)`;

cliErrors();

const args = process.argv.slice(2).filter((arg) => arg !== '--');
if (args.includes('--help') || args.includes('-h')) {
  console.log(usage);
  process.exit(0);
}
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const [, value] = args.splice(i, 2);
  if (!value) throw new Error(`--${name} needs a value`);
  return value;
};
const board = z.enum([...brokerBoards, 'all']).parse(option('board', 'regular'));
const top = z.coerce.number().int().positive().parse(option('top', '8'));
const [command, rawTicker, rawDates] = args;
const state = await fixtureState();
const api = await localBrokerApi();
const ticker = () => {
  const parsed = z
    .string()
    .regex(/^[A-Z0-9-]{1,12}$/)
    .safeParse(rawTicker?.toUpperCase());
  if (!parsed.success) throw new Error(`Give a ticker.\n\n${usage}`);
  return parsed.data;
};
const range = () => {
  const [from, to = from] = (rawDates ?? state.asOf).split('..');
  return z.tuple([z.iso.date(), z.iso.date()]).parse([from, to]);
};

if (!command) {
  const tickers = await readdir(join(fixturesRoot, 'bucket/site/broker'));
  console.log(`as of     ${state.asOf}`);
  console.log(`sessions  ${state.sessions.join(' ')}`);
  console.log(`broker    ${tickers.length} tickers, daily from January`);
  console.log(`data      ${fixturesRoot}\n\n${usage}`);
} else if (command === 'brk') {
  const code = ticker();
  const [from, to] = range();
  const body = await api.json(`ticker=${code}`);
  if (!body) throw new Error(`No broker data for ${code}.`);
  const history = brokerHistorySchema.parse(body);
  const days = history.days.filter(
    (day) => day.date >= from && day.date <= to && (board === 'all' || day.board === board),
  );
  if (!days.length) throw new Error(`${code} has no ${board} broker data from ${from} to ${to}.`);
  const dates = new Set(days.map((day) => day.date));
  const rows = aggregateBrokers(days)
    .map((b) => ({ ...b, net: b.buyValue - b.sellValue, lots: (b.buy - b.sell) / 100 }))
    .sort((a, b) => b.net - a.net);
  const total = rows.reduce((sum, b) => sum + b.buyValue, 0);
  console.log(
    `${code} ${board}, ${from}${to === from ? '' : ` to ${to}`}, ${dates.size} session${dates.size === 1 ? '' : 's'}, value ${money(total)}\n`,
  );
  const line = (b: (typeof rows)[number]) => [
    b.code,
    b.broker_type,
    money(b.buyValue),
    money(b.sellValue),
    money(b.net),
    Math.round(b.lots).toLocaleString('en'),
    brokerName(b.code),
  ];
  const header = (side: string) => [
    side,
    'broker type',
    'buy IDR',
    'sell IDR',
    'net IDR',
    'net lot',
    'name',
  ];
  table(
    rows
      .filter((b) => b.net > 0)
      .slice(0, top)
      .map(line),
    header('NET BUY'),
  );
  console.log();
  table(
    rows
      .filter((b) => b.net < 0)
      .reverse()
      .slice(0, top)
      .map(line),
    header('NET SELL'),
  );
  // Printed figures are rounded, so comparing them by eye with running trade proves little.
  console.log(
    `\nto check every broker exactly against running trade, run: pnpm verify:data ${code} --dates ${from === to ? from : `${from}..${to}`} --check brk-rt`,
  );
} else if (command === 'rt') {
  const code = ticker();
  const [date] = range();
  const body = await api.json(`view=ticks&ticker=${code}&date=${date}&kind=trades`);
  if (!body)
    throw new Error(
      `No running trade for ${code} on ${date}. Sessions: ${state.sessions.join(' ')}`,
    );
  const t = tickTradesSchema.parse(body);
  const boardCode = { regular: 'RG', negotiation: 'NG', cash: 'TN' } as const;
  const picked = t.time
    .map((_, i) => i)
    .filter((i) => board === 'all' || t.board[i] === boardCode[board]);
  if (!picked.length) throw new Error(`${code} has no ${board} trades on ${date}.`);
  const prices = picked.map((i) => t.price[i]!);
  const shares = picked.reduce((sum, i) => sum + t.shares[i]!, 0);
  const value = picked.reduce((sum, i) => sum + t.price[i]! * t.shares[i]!, 0);
  const net = new Map<string, number>();
  for (const i of picked) {
    const amount = t.price[i]! * t.shares[i]!;
    net.set(t.buyer[i]!, (net.get(t.buyer[i]!) ?? 0) + amount);
    net.set(t.seller[i]!, (net.get(t.seller[i]!) ?? 0) - amount);
  }
  const counts = new Map<string, number>();
  for (const b of t.board) counts.set(b, (counts.get(b) ?? 0) + 1);
  const boards = [...counts].map(([b, n]) => `${b} ${n}`);
  console.log(`${code} ${date}, ${board} board`);
  table(
    [
      ['trades', picked.length.toLocaleString('en')],
      ['time', `${clock(t.time[picked[0]!]!)} to ${clock(t.time[picked.at(-1)!]!)}`],
      [
        'open high low close',
        `${prices[0]} ${Math.max(...prices)} ${Math.min(...prices)} ${prices.at(-1)}`,
      ],
      ['lot', (shares / 100).toLocaleString('en')],
      ['value', money(value)],
      ['all boards', boards.join(', ')],
    ],
    ['', ''],
  );
  const ranked = [...net].sort((a, b) => b[1] - a[1]);
  const line = ([code, amount]: [string, number]) => [code, money(amount), brokerName(code)];
  console.log();
  table(
    ranked
      .filter(([, a]) => a > 0)
      .slice(0, top)
      .map(line),
    ['NET BUY', 'value', 'name'],
  );
  console.log();
  table(
    ranked
      .filter(([, a]) => a < 0)
      .reverse()
      .slice(0, top)
      .map(line),
    ['NET SELL', 'value', 'name'],
  );
} else {
  throw new Error(`Unknown command ${command}.\n\n${usage}`);
}
