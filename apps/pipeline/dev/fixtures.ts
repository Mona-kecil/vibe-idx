import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { DuckDBInstance } from '@duckdb/node-api';
import { z } from 'zod';
import { publishBrokerActivity } from '../broker-publication';
import { createR2, publishAccumulation, type R2 } from '../brokers';
import { sqlLiteral as lit } from '../ticks-data';
import { TickStore } from '../ticks-store';
import { cliErrors, plural } from './cli';
import {
  cutBrokerData,
  cutPrices,
  takeLock,
  fixturePaths,
  fixtureStateSchema,
  localR2,
  writeAtomic,
} from './local-r2';

cliErrors();
const { values: args } = parseArgs({
  options: {
    sessions: { type: 'string', default: '10' },
    latest: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (args.help) {
  console.log(`pnpm fixtures [--latest] [--sessions N]

Copies running trade and the year's broker data from the private bucket, read-only, and builds the files the app
reads with the pipeline's publication code. Reruns skip finished work and rebuild what changed publication code
affects. The window ends at the newest session with complete broker data.

--latest      check the private bucket for newer sessions and move the window forward
--sessions N  sessions in the window, 10 by default

The folder is ~/.cache/vibe-idx/local, or VIBE_IDX_FIXTURES for this and every other dev command.`);
  process.exit(0);
}
const sessions = z.coerce.number().int().positive().max(60).parse(args.sessions);
const paths = fixturePaths();
await takeLock('fixtures');
type State = z.infer<typeof fixtureStateSchema>;

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
  const file = join(paths.cache, key);
  if (!fresh && existsSync(file)) return file;
  reads++;
  const object = await remoteGet(key);
  if (!object) throw new Error(`Missing from the private bucket: ${key}`);
  await writeAtomic(file, object.bytes);
  return file;
}

/** Running trade and order book sources come from the cache, everything else stays local. */
const local = localR2(paths.bucket, async (key) =>
  /^ticks\/(running_trade|closing_book)\/\d{4}-\d{2}-\d{2}\.parquet$/.test(key)
    ? readFile(await source(key))
    : undefined,
);
/** The app files each build wrote, so files that no current build writes can be removed. */
const outputsFile = join(paths.root, 'outputs.json');
const outputs = z
  .record(z.string(), z.array(z.string()))
  .parse(existsSync(outputsFile) ? JSON.parse(await readFile(outputsFile, 'utf8')) : {});
let building: Set<string> | undefined;
const sandbox: R2 = {
  ...local,
  put(key, bytes, condition) {
    building?.add(key);
    return local.put(key, bytes, condition);
  },
};
let manifestsCleared = false;
async function build(key: string, run: () => Promise<void>) {
  // Publication skips files its manifest says are unchanged, so without the manifests every file is written and
  // recorded, and the cleanup below never removes a current file.
  const site = join(paths.bucket, 'site');
  if (!manifestsCleared)
    for (const file of existsSync(site) ? await readdir(site) : [])
      if (file.endsWith('-publication.json')) await rm(join(site, file));
  manifestsCleared = true;
  building = new Set();
  await run();
  outputs[key] = [...building].filter((written) => written.startsWith('site/')).sort();
  building = undefined;
  await writeAtomic(outputsFile, JSON.stringify(outputs));
}

const db = await (await DuckDBInstance.create(':memory:')).connect();
const rows = async (sql: string) => (await db.runAndReadAll(sql)).getRowObjectsJson();

/**
 * The newest sessions with complete running trade, ending at the last one that also has complete broker data, so
 * every view agrees. Order books started later, so they may be missing.
 */
async function pickWindow(fresh: boolean): Promise<Pick<State, 'asOf' | 'sessions'>> {
  const ledger = await source('ticks/ledger.parquet', fresh);
  const coverage = await source('parquet/broker-activity-coverage.parquet', fresh);
  const [broker] =
    await rows(`SELECT max(date)::VARCHAR AS last FROM read_parquet(${lit(coverage)}) d
    WHERE broker IS NULL AND listed AND NOT EXISTS (SELECT 1 FROM read_parquet(${lit(coverage)}) t
      WHERE t.date = d.date AND t.board = d.board AND t.broker IS NOT NULL AND t.complete IS DISTINCT FROM true)`);
  const dates = await rows(`SELECT date::VARCHAR AS date FROM read_parquet(${lit(ledger)})
    WHERE date <= ${lit(z.iso.date().parse(broker?.last))}::DATE AND dataset = 'running_trade' GROUP BY date
    HAVING bool_and(status IN ('complete', 'no_trades'))
    ORDER BY date DESC LIMIT ${sessions}`);
  const picked = dates.map((r) => z.iso.date().parse(r.date)).reverse();
  const asOf = picked.at(-1);
  if (!asOf) throw new Error('No session has complete running trade and broker data.');
  return { asOf, sessions: picked };
}

/** A hash of the publication code, so fixtures made by other code are made again. */
async function codeVersion(...files: string[]) {
  const hash = createHash('sha256');
  for (const file of files) hash.update(await readFile(new URL(file, import.meta.url)));
  return hash.digest('hex').slice(0, 12);
}

const saved = existsSync(paths.state)
  ? fixtureStateSchema.parse(JSON.parse(await readFile(paths.state, 'utf8')))
  : undefined;
const state: State =
  saved && !args.latest && saved.sessions.length === sessions
    ? saved
    : {
        generated: saved?.generated ?? {},
        ...(await step('pick sessions', () => pickWindow(args.latest))),
      };
const save = () => writeAtomic(paths.state, JSON.stringify(state, null, 2) + '\n');
await save();
console.log(`as of ${state.asOf}, sessions ${state.sessions[0]} to ${state.sessions.at(-1)}`);

const brokerCode = await codeVersion(
  '../broker-publication.ts',
  '../brokers.ts',
  '../sql.ts',
  './local-r2.ts',
);
const brokerKey = `broker@${state.asOf}`;
if (state.generated[brokerKey] !== brokerCode) {
  const [activity, coverage, prices] = await step('download broker data', async () => [
    await source(`parquet/broker_activity/${state.asOf.slice(0, 4)}.parquet`, args.latest),
    await source('parquet/broker-activity-coverage.parquet', args.latest),
    await source(`parquet/prices/${state.asOf.slice(0, 4)}.parquet`, args.latest),
  ]);
  await step('broker files', () =>
    build(brokerKey, async () => {
      const data = join(paths.work, 'broker');
      await cutBrokerData(activity, coverage, state.asOf, data);
      await cutPrices(prices, state.asOf, data);
      // As the collector does: the market accumulation file, then the broker files.
      await publishAccumulation(data, join(data, 'out'), sandbox);
      await publishBrokerActivity(data, join(data, 'out'), sandbox);
      await rm(data, { recursive: true, force: true });
    }),
  );
  state.generated[brokerKey] = brokerCode;
  await save();
}

const tickCode = await codeVersion('../ticks-store.ts', '../ticks-data.ts', './local-r2.ts');
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
    const store = await TickStore.open(join(paths.work, 'ticks'), sandbox);
    try {
      await step(`running trade ${date}`, () =>
        build(`ticks@${date}`, async () => {
          if (!(await store.recoverPublished(date, 'running_trade')))
            throw new Error(`No published running trade for ${date}`);
          if (books.has(date)) await store.recoverPublished(date, 'closing_book');
        }),
      );
    } finally {
      store.close();
    }
    state.generated[`ticks@${date}`] = tickCode;
    await save();
    await rm(join(paths.work, 'ticks'), { recursive: true, force: true });
  }
}

// Files from older code, another branch's code, or sessions that left the window.
const keys = [brokerKey, ...state.sessions.map((date) => `ticks@${date}`)];
if (keys.every((key) => outputs[key])) {
  const live = new Set(keys.flatMap((key) => outputs[key]!));
  const site = join(paths.bucket, 'site');
  const files = existsSync(site)
    ? await readdir(site, { recursive: true, withFileTypes: true })
    : [];
  let removed = 0;
  for (const file of files) {
    const full = join(file.parentPath, file.name);
    if (!file.isFile() || live.has(relative(paths.bucket, full))) continue;
    await rm(full);
    removed++;
  }
  const folders = files
    .filter((file) => file.isDirectory())
    .map((file) => join(file.parentPath, file.name));
  // Deepest first, so a folder emptied by removing its subfolders goes too.
  for (const folder of folders.sort((a, b) => b.length - a.length))
    if (!(await readdir(folder)).length) await rm(folder, { recursive: true });
  for (const key of Object.keys(outputs)) if (!keys.includes(key)) delete outputs[key];
  await writeAtomic(outputsFile, JSON.stringify(outputs));
  if (removed) console.log(`removed ${plural(removed, 'file')} that no current build writes`);
}

console.log(
  `done in ${((performance.now() - started) / 1000).toFixed(1)}s, peak ${Math.round(process.resourceUsage().maxRSS / 1024)} MB, ${reads} reads from the private bucket, data in ${paths.bucket}`,
);
