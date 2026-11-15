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
import { z } from 'zod';
import type { publishBrokerActivity as PublishBrokerActivity } from '../broker-publication';
import type { TickStore as Store } from '../ticks-store';
import { fixturePaths, localR2 } from './local-r2';

const [pipeline, step, date, run, brokerData] = z
  .tuple([z.string(), z.enum(['broker', 'ticks']), z.iso.date(), z.string(), z.string()])
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
// Parquet bytes carry writer details, so the output digest covers the published JSON only.
const written = new Map<string, string>();
const r2 = {
  ...storage,
  async put(key: string, bytes: Buffer, condition?: Parameters<typeof storage.put>[2]) {
    if (!key.endsWith('.parquet'))
      written.set(
        key,
        createHash('sha256')
          .update(key.endsWith('.gz') ? gunzipSync(bytes) : bytes)
          .digest('hex'),
      );
    return storage.put(key, bytes, condition);
  },
};

let work: () => Promise<void>;
if (step === 'broker') {
  const { publishBrokerActivity } = (await load('broker-publication.ts')) as {
    publishBrokerActivity: typeof PublishBrokerActivity;
  };
  work = () => publishBrokerActivity(brokerData, join(run, 'out'), r2);
} else {
  const { TickStore } = (await load('ticks-store.ts')) as { TickStore: typeof Store };
  work = async () => {
    for (const dataset of ['running_trade', 'closing_book'] as const) {
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
const digest = createHash('sha256');
for (const [key, hash] of [...written].sort(([a], [b]) => a.localeCompare(b)))
  digest.update(`${key} ${hash}\n`);
console.log(
  JSON.stringify({
    seconds,
    peakMB: Math.round(process.resourceUsage().maxRSS / 1024),
    files: written.size,
    digest: digest.digest('hex').slice(0, 12),
  }),
);
