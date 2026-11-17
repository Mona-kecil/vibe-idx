/**
 * One publication run in its own process, so its peak memory is its own. bench-publish.ts starts it with the
 * pipeline folder whose code to run, and reads the JSON it prints.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { DuckDBInstance } from '@duckdb/node-api';
import { z } from 'zod';
import type { publishBrokerActivity as PublishBrokerActivity } from '../broker-publication';
import type { TickStore as Store } from '../ticks-store';
import { fixturePaths, localR2 } from './local-r2';

const [pipeline, step, date, run, brokerData] = z
  .tuple([
    z.string(),
    z.enum(['broker', 'ticks', 'running_trade', 'closing_book']),
    z.iso.date(),
    z.string(),
    z.string(),
  ])
  .parse(process.argv.slice(2));
const paths = fixturePaths();
const load = (file: string) => import(pathToFileURL(join(pipeline, file)).href);

// Sources come from the fixture cache, and the run starts from an empty bucket, so every run does the full work.
const sources = new Set([
  'ticks/ledger.parquet',
  `ticks/running_trade/${date}.parquet`,
  `ticks/closing_book/${date}.parquet`,
]);
const storage = localR2(join(run, 'bucket'), async (key) =>
  sources.has(key) && existsSync(join(paths.cache, key))
    ? readFile(join(paths.cache, key))
    : undefined,
);
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const written = new Map<string, string>();
const parquet = new Set<string>();
const r2 = {
  ...storage,
  async put(key: string, bytes: Buffer, condition?: Parameters<typeof storage.put>[2]) {
    if (key.endsWith('.parquet')) parquet.add(key);
    else written.set(key, hash(key.endsWith('.gz') ? gunzipSync(bytes) : bytes));
    return storage.put(key, bytes, condition);
  },
};

/** Parquet bytes carry writer details, so a parquet file counts by its rows, in file order. */
async function parquetRows() {
  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  try {
    for (const key of parquet) {
      const file = join(run, 'bucket', key).replaceAll("'", "''");
      const rows = (
        await db.runAndReadAll(`SELECT * FROM read_parquet('${file}')`)
      ).getRowObjectsJson();
      written.set(key, hash(JSON.stringify(rows)));
    }
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}

let work: () => Promise<void>;
if (step === 'broker') {
  const { publishBrokerActivity } = (await load('broker-publication.ts')) as {
    publishBrokerActivity: typeof PublishBrokerActivity;
  };
  work = () => publishBrokerActivity(brokerData, join(run, 'out'), r2);
} else {
  const { TickStore } = (await load('ticks-store.ts')) as { TickStore: typeof Store };
  work = async () => {
    const datasets =
      step === 'ticks' ? (['running_trade', 'closing_book'] as const) : ([step] as const);
    for (const dataset of datasets) {
      if (!existsSync(join(paths.cache, `ticks/${dataset}/${date}.parquet`))) continue;
      // A store per dataset, as in production.
      const store = await TickStore.open(join(run, 'data'), r2);
      try {
        await store.recoverPublished(date, dataset);
      } finally {
        store.close();
      }
    }
  };
}

const started = performance.now();
await work();
const seconds = (performance.now() - started) / 1000;
await parquetRows();
// The whole process, so the benchmark can tell its own CPU from other processes'.
const cpu = process.cpuUsage();
const digest = createHash('sha256');
for (const [key, hash] of [...written].sort(([a], [b]) => a.localeCompare(b)))
  digest.update(`${key} ${hash}\n`);
console.log(
  JSON.stringify({
    seconds,
    peakMB: Math.round(process.resourceUsage().maxRSS / 1024),
    cpuSeconds: (cpu.user + cpu.system) / 1e6,
    files: written.size,
    digest: digest.digest('hex').slice(0, 12),
  }),
);
