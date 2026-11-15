import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { DuckDBInstance } from '@duckdb/node-api';
import { z } from 'zod';
import { publishBrokerActivity } from '../broker-publication';
import { createR2 } from '../brokers';
import type { R2 } from '../brokers';
import { sqlLiteral as lit } from '../ticks-data';
import { TickStore } from '../ticks-store';

const { values: args } = parseArgs({
  options: {
    sessions: { type: 'string', default: '10' },
    latest: { type: 'boolean', default: false },
    root: { type: 'string', default: join(homedir(), '.cache/vibe-idx/local') },
  },
});
const sessions = z.coerce.number().int().positive().max(60).parse(args.sessions);
const root = args.root;
/** What the app's storage would hold: the pipeline writes here and the preview reads from here. */
const bucket = join(root, 'bucket');
/** Source objects copied from the private bucket, each downloaded once. */
const cache = join(root, 'r2');
const work = join(root, 'work');
const stateFile = join(root, 'fixtures.json');

const stateSchema = z.object({
  asOf: z.iso.date(),
  sessions: z.array(z.iso.date()),
  generated: z.record(z.string(), z.string()).default({}),
});
type State = z.infer<typeof stateSchema>;

const started = performance.now();
const step = async <T>(label: string, run: () => Promise<T>) => {
  const t = performance.now();
  const result = await run();
  console.log(`${label.padEnd(44)} ${((performance.now() - t) / 1000).toFixed(1).padStart(6)}s`);
  return result;
};

const env = join(homedir(), '.config/vibe-idx/env');
if (!process.env.R2_ACCOUNT_ID && existsSync(env)) process.loadEnvFile(env);
const accountId = process.env.R2_ACCOUNT_ID;
if (!accountId) throw new Error(`R2_ACCOUNT_ID is missing. Put the R2 credentials in ${env}.`);
// Only reads leave this closure, so nothing here can write to the private bucket.
const remoteGet = (() => {
  const r2 = createR2({ accountId });
  return (key: string) => r2.get(key);
})();
let reads = 0;

/** Copies a source object from the private bucket into the cache once; `fresh` fetches it again. */
async function source(key: string, fresh = false) {
  const file = join(cache, key);
  if (!fresh && existsSync(file)) return file;
  reads++;
  const object = await remoteGet(key);
  if (!object) throw new Error(`Missing from the private bucket: ${key}`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file + '.tmp', object.bytes);
  await rename(file + '.tmp', file);
  return file;
}

/** Storage for the pipeline code: running trade and order book sources come from the cache, everything else stays local. */
const sandbox: R2 = {
  async get(key) {
    const local = join(bucket, key);
    if (existsSync(local)) return { bytes: await readFile(local), etag: 'local' };
    if (!/^ticks\/(running_trade|closing_book)\/\d{4}-\d{2}-\d{2}\.parquet$/.test(key)) return;
    return { bytes: await readFile(await source(key)), etag: 'source' };
  },
  async put(key, bytes) {
    const file = join(bucket, key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file + '.tmp', bytes);
    await rename(file + '.tmp', file);
    return 'local';
  },
  async delete(key) {
    await rm(join(bucket, key), { force: true });
  },
};

const db = await (await DuckDBInstance.create(':memory:')).connect();
const rows = async (sql: string) => (await db.runAndReadAll(sql)).getRowObjectsJson();

/** The newest dates with complete broker data and complete running trade, so every view agrees. Order books started later, so they may be missing. */
async function pickWindow(fresh: boolean): Promise<Pick<State, 'asOf' | 'sessions'>> {
  const ledger = await source('ticks/ledger.parquet', fresh);
  const coverage = await source('parquet/broker-activity-coverage.parquet', fresh);
  const [broker] =
    await rows(`SELECT max(date)::VARCHAR AS last FROM read_parquet(${lit(coverage)}) d
    WHERE broker IS NULL AND listed AND NOT EXISTS (SELECT 1 FROM read_parquet(${lit(coverage)}) t
      WHERE t.date = d.date AND t.board = d.board AND t.broker IS NOT NULL AND t.complete IS DISTINCT FROM true)`);
  const asOf = z.iso.date().parse(broker?.last);
  const dates = await rows(`SELECT date::VARCHAR AS date FROM read_parquet(${lit(ledger)})
    WHERE date <= ${lit(asOf)}::DATE AND dataset = 'running_trade' GROUP BY date
    HAVING bool_and(status IN ('complete', 'no_trades'))
    ORDER BY date DESC LIMIT ${sessions}`);
  return { asOf, sessions: dates.map((r) => z.iso.date().parse(r.date)).reverse() };
}

/** A hash of the publication code, so fixtures made by other code are made again. */
async function codeVersion(...files: string[]) {
  const hash = createHash('sha256');
  for (const file of files) hash.update(await readFile(new URL(file, import.meta.url)));
  return hash.digest('hex').slice(0, 12);
}

const saved = existsSync(stateFile)
  ? stateSchema.parse(JSON.parse(await readFile(stateFile, 'utf8')))
  : undefined;
const state: State =
  saved && !args.latest && saved.sessions.length >= sessions
    ? saved
    : {
        generated: saved?.generated ?? {},
        ...(await step('pick sessions', () => pickWindow(args.latest))),
      };
const save = () => writeFile(stateFile, JSON.stringify(state, null, 2) + '\n');
await mkdir(root, { recursive: true });
await save();
console.log(`as of ${state.asOf}, sessions ${state.sessions[0]} to ${state.sessions.at(-1)}`);

const brokerCode = await codeVersion('../broker-publication.ts');
const brokerKey = `broker@${state.asOf}`;
if (state.generated[brokerKey] !== brokerCode) {
  const year = state.asOf.slice(0, 4);
  const [activity, coverage] = await step('download broker data', async () => [
    await source(`parquet/broker_activity/${year}.parquet`, args.latest),
    await source('parquet/broker-activity-coverage.parquet', args.latest),
  ]);
  await step('broker files', async () => {
    const data = join(work, 'broker');
    await rm(data, { recursive: true, force: true });
    await mkdir(join(data, 'parquet', 'broker_activity'), { recursive: true });
    // Cut at the as-of date, so broker data never runs ahead of running trade.
    await db.run(`COPY (SELECT * FROM read_parquet(${lit(activity)}) WHERE date <= ${lit(state.asOf)}::DATE)
        TO ${lit(join(data, 'parquet', 'broker_activity', `${year}.parquet`))} (FORMAT PARQUET);
      COPY (SELECT * FROM read_parquet(${lit(coverage)}) WHERE date <= ${lit(state.asOf)}::DATE)
        TO ${lit(join(data, 'parquet', 'broker-activity-coverage.parquet'))} (FORMAT PARQUET)`);
    await publishBrokerActivity(data, join(data, 'out'), sandbox);
    await rm(data, { recursive: true, force: true });
  });
  state.generated[brokerKey] = brokerCode;
  await save();
}

const tickCode = await codeVersion('../ticks-store.ts', '../ticks-data.ts');
const pending = state.sessions.filter((date) => state.generated[`ticks@${date}`] !== tickCode);
if (pending.length) {
  const books = new Set(
    (
      await rows(`SELECT DISTINCT date::VARCHAR AS date FROM read_parquet(${lit(await source('ticks/ledger.parquet'))})
        WHERE dataset = 'closing_book' AND status = 'complete'`)
    ).map((r) => z.iso.date().parse(r.date)),
  );
  for (const date of pending) {
    // A store per session, as in production: DuckDB keeps the memory of deleted rows.
    const store = await TickStore.open(join(work, 'ticks'), sandbox);
    try {
      await step(`running trade ${date}`, async () => {
        if (!(await store.recoverPublished(date, 'running_trade')))
          throw new Error(`No published running trade for ${date}`);
        if (books.has(date)) await store.recoverPublished(date, 'closing_book');
      });
    } finally {
      store.close();
    }
    state.generated[`ticks@${date}`] = tickCode;
    await save();
    await rm(join(work, 'ticks'), { recursive: true, force: true });
  }
}

console.log(
  `done in ${((performance.now() - started) / 1000).toFixed(1)}s, peak ${Math.round(process.resourceUsage().maxRSS / 1024)} MB, ${reads} reads from the private bucket, data in ${bucket}`,
);
