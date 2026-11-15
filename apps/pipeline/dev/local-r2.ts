import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { z } from 'zod';
import type { R2 } from '../brokers';

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
export const fixtureStateSchema = z.object({
  asOf: z.iso.date(),
  sessions: z.array(z.iso.date()),
  generated: z.record(z.string(), z.string()).default({}),
});

export async function writeAtomic(file: string, bytes: Buffer | string) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file + '.tmp', bytes);
  await rename(file + '.tmp', file);
}

/**
 * Storage for the pipeline code in a local folder. Reads fall back to `source` for keys the folder doesn't have
 * yet, which is how source objects reach the pipeline without it ever writing to the real bucket.
 */
export function localR2(bucket: string, source: (key: string) => Promise<Buffer | undefined>): R2 {
  return {
    async get(key) {
      const local = join(bucket, key);
      if (existsSync(local)) return { bytes: await readFile(local), etag: 'local' };
      const bytes = await source(key);
      return bytes && { bytes, etag: 'source' };
    },
    async put(key, bytes) {
      await writeAtomic(join(bucket, key), bytes);
      return 'local';
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
