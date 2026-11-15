import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    lock: join(root, 'fixtures.lock'),
  };
}

/** The pid of a `pnpm fixtures` still writing the fixtures, if one is. */
export function fixturesWriter(root?: string) {
  const { lock } = fixturePaths(root);
  const pid = existsSync(lock) ? Number(readFileSync(lock, 'utf8')) : 0;
  return pid && pid !== process.pid && alive(pid) ? pid : undefined;
}

/** Lets one `pnpm fixtures` write at a time, until this process exits. */
export async function lockFixtures() {
  const { root, lock } = fixturePaths();
  await mkdir(root, { recursive: true });
  try {
    writeFileSync(lock, String(process.pid), { flag: 'wx' });
  } catch {
    const writer = fixturesWriter();
    if (writer)
      throw new Error(
        `Another \`pnpm fixtures\` (pid ${writer}) is writing ${root}. Wait for it to finish.`,
      );
    // A lock left by a run that was killed belongs to no live process, so it is taken over.
    writeFileSync(lock, String(process.pid));
  }
  process.once('exit', () => rmSync(lock, { force: true }));
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
