import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { z } from 'zod';
import type { R2 } from '../brokers';
import { alive } from './cli';

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * Where the fixtures live. `bucket` is what the app's storage would hold, `cache` the source objects copied
 * from the private bucket, each downloaded once.
 */
export function fixturePaths(
  root = process.env.VIBE_IDX_FIXTURES ?? join(homedir(), '.cache/vibe-idx/local'),
) {
  return {
    root,
    bucket: join(root, 'bucket'),
    cache: join(root, 'r2'),
    work: join(root, 'work'),
    state: join(root, 'fixtures.json'),
  };
}

/**
 * Where a lock lives. `fixtures` is held while one fixture folder is rewritten, so it lives in that folder. `bench`
 * is held while a benchmark runs, since two at once skew each other's timings and can run out of memory whichever
 * fixtures they read, so it has one place per user that no setting moves.
 */
const lockFile = (name: 'fixtures' | 'bench') =>
  name === 'bench'
    ? join(homedir(), '.cache/vibe-idx/bench.lock')
    : join(fixturePaths().root, 'fixtures.lock');

/** The pid holding the lock, if it's alive. */
export function lockHolder(name: 'fixtures' | 'bench') {
  const file = lockFile(name);
  const pid = existsSync(file) ? Number(readFileSync(file, 'utf8')) : 0;
  return pid && pid !== process.pid && alive(pid) ? pid : undefined;
}

/**
 * Holds the lock until this process exits. A benchmark waits for the one before it; fixtures fail naming the
 * process that holds the lock.
 */
export async function takeLock(name: 'fixtures' | 'bench') {
  const file = lockFile(name);
  await mkdir(dirname(file), { recursive: true });
  let waiting = false;
  let announced: number | undefined;
  for (;;) {
    try {
      writeFileSync(file, String(process.pid), { flag: 'wx' });
      break;
    } catch {
      const holder = lockHolder(name);
      if (!holder) {
        // A lock left by a run that was killed belongs to no live process, so it is taken over.
        writeFileSync(file, String(process.pid));
        break;
      }
      if (name === 'fixtures')
        throw new Error(
          `Another \`pnpm fixtures\` (pid ${holder}) is writing ${fixturePaths().root}. Wait for it to finish.`,
        );
      // Several can queue, so the holder can change while this one waits.
      if (holder !== announced) {
        const minutes = Math.round((Date.now() - statSync(file).mtimeMs) / 60000);
        console.warn(
          `waiting for the benchmark already running (pid ${holder}, for ${minutes} min; a broker step takes about a minute a run) to finish`,
        );
        announced = holder;
      }
      waiting = true;
      await new Promise((done) => setTimeout(done, 1000));
    }
  }
  if (waiting) console.warn('it finished, starting');
  process.once('exit', () => rmSync(file, { force: true }));
}

export const fixtureStateSchema = z.object({
  asOf: z.iso.date(),
  sessions: z.array(z.iso.date()),
  generated: z.record(z.string(), z.string()).default({}),
});

/** Readers never see a half-written file, and two processes writing one file never share a temporary file. */
export async function writeAtomic(file: string, bytes: Buffer | string) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, file);
}

const etagOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/**
 * Storage for the pipeline code in a local folder. Reads fall back to `source` for keys the folder doesn't have
 * yet, which is how source objects reach the pipeline without it ever writing to the real bucket. Conditional
 * puts fail as R2's do, with content hashes as ETags.
 */
export function localR2(bucket: string, source: (key: string) => Promise<Buffer | undefined>): R2 {
  const get: R2['get'] = async (key) => {
    const local = join(bucket, key);
    const bytes = existsSync(local) ? await readFile(local) : await source(key);
    return bytes && { bytes, etag: etagOf(bytes) };
  };
  return {
    get,
    async put(key, bytes, condition) {
      if (condition) {
        const current = await get(key);
        if ('ifNoneMatch' in condition ? current : current?.etag !== condition.ifMatch)
          throw new Error(`R2 HTTP 412: ${key}`);
      }
      await writeAtomic(join(bucket, key), bytes);
      return etagOf(bytes);
    },
    async delete(key) {
      await rm(join(bucket, key), { force: true });
    },
  };
}

/** The year's broker data cut at the as-of date, laid out the way `publishBrokerActivity` reads it. */
export async function cutBrokerData(
  activity: string,
  coverage: string,
  asOf: string,
  data: string,
) {
  await rm(data, { recursive: true, force: true });
  await mkdir(join(data, 'parquet', 'broker_activity'), { recursive: true });
  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  try {
    // Cut at the as-of date, so broker data never runs ahead of running trade.
    await db.run(`COPY (SELECT * FROM read_parquet(${literal(activity)}) WHERE date <= ${literal(asOf)}::DATE)
        TO ${literal(join(data, 'parquet', 'broker_activity', `${asOf.slice(0, 4)}.parquet`))} (FORMAT PARQUET);
      COPY (SELECT * FROM read_parquet(${literal(coverage)}) WHERE date <= ${literal(asOf)}::DATE)
        TO ${literal(join(data, 'parquet', 'broker-activity-coverage.parquet'))} (FORMAT PARQUET)`);
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}

/** The year's daily prices cut at the as-of date, so the latest session they show is the fixtures' own. */
export async function cutPrices(prices: string, asOf: string, data: string) {
  await mkdir(join(data, 'parquet', 'prices'), { recursive: true });
  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  try {
    await db.run(`COPY (SELECT * FROM read_parquet(${literal(prices)}) WHERE date <= ${literal(asOf)}::DATE)
      TO ${literal(join(data, 'parquet', 'prices', `${asOf.slice(0, 4)}.parquet`))} (FORMAT PARQUET)`);
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}
