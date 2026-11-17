import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { backfill, lookback, politeGoogle, retag } from './src/backfill';
import { directoryBucket, r2Bucket } from './src/storage';
import { tickerSchema } from './src/contracts';
import { tickerTagger } from './src/tagging';

const usage = `pnpm --filter @vibe-idx/feeds backfill --local [DIR] | --r2 [--months 12] [--tickers BBCA,TLKM] [--delay 3000] [--retag]

Fills the news archive back from Google News, one ticker at a time, through the merge the Feeds job uses, so a
rerun adds nothing. Run it from a machine Google News answers, not from a Cloudflare Worker.
--local DIR   writes to DIR, the public bucket's files; default is the fixtures' public folder
--r2          writes to the real public bucket, with the Feeds job's R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and
              R2_SECRET_ACCESS_KEY; it never does so unless asked
--months N    how far back, 12 by default
--tickers     only these codes
--delay MS    between Google requests, 3000 by default; it backs off by itself on 429 and 503
--retag       with --local, tag the archive again with the current tagger and stop, without asking Google
A run that stops resumes where it stopped: finished tickers are listed in the state file next to DIR.`;

const { values: args } = parseArgs({
  options: {
    local: { type: 'string' },
    r2: { type: 'boolean', default: false },
    months: { type: 'string', default: '12' },
    tickers: { type: 'string' },
    delay: { type: 'string', default: '3000' },
    retag: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (args.help || (args.local === undefined) === !args.r2) {
  console.log(usage);
  process.exit(args.help ? 0 : 1);
}

const fixtures = join(
  process.env.VIBE_IDX_FIXTURES ?? join(homedir(), '.cache/vibe-idx/local'),
  'public',
);
const directory = args.local || fixtures;
const now = new Date();
const bucket = args.r2
  ? r2Bucket(
      z
        .object({
          accountId: z.string().regex(/^[a-f0-9]{32}$/),
          accessKeyId: z.string().min(1),
          secretAccessKey: z.string().min(1),
        })
        .parse({
          accountId: process.env.R2_ACCOUNT_ID,
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        }),
    )
  : directoryBucket(directory);
const stateFile = args.r2
  ? join(homedir(), '.cache/vibe-idx/news-backfill-r2.json')
  : join(dirname(directory), 'news-backfill.json');

const tickers = tickerSchema.parse(
  args.r2
    ? await (await fetch('https://pub-7982bfb066694e6e8615750132283eba.r2.dev/tickers.json')).json()
    : JSON.parse(await readFile(join(directory, 'tickers.json'), 'utf8')),
);
const tag = tickerTagger(tickers);

if (args.retag) {
  if (args.r2) throw new Error('--retag runs on a local copy: pass --local');
  const months = (await readdir(join(directory, 'news/archive')).catch(() => [] as string[]))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
  console.log(
    `retagged ${await retag(bucket, months, tag, now)} articles in ${months.length} months`,
  );
  process.exit(0);
}

const wanted = args.tickers?.split(',').map((t) => t.trim().toUpperCase());
const chosen = wanted ? tickers.filter((t) => wanted.includes(t.ticker)) : tickers;
const missing = wanted?.filter((code) => !chosen.some((t) => t.ticker === code)) ?? [];
if (missing.length) throw new Error(`Not in tickers.json: ${missing.join(', ')}`);
const done: string[] = z
  .object({ done: z.array(z.string()) })
  .catch({ done: [] })
  .parse(JSON.parse(await readFile(stateFile, 'utf8').catch(() => 'null'))).done;

const window = lookback(now, z.coerce.number().int().min(1).max(24).parse(args.months));
console.log(
  `${args.r2 ? 'REAL BUCKET' : directory}  ${window.from}..${window.to}  ${chosen.length - chosen.filter((t) => done.includes(t.ticker)).length} tickers left`,
);
const started = performance.now();
const totals = await backfill({
  bucket,
  tickers: chosen,
  window,
  fetchPage: politeGoogle({
    delay: z.coerce.number().int().min(500).parse(args.delay),
    log: console.error,
  }),
  tag,
  now,
  done,
  finished: async (codes) => {
    done.push(...codes);
    await mkdir(dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify({ done }));
  },
  log: (line) => console.log(line),
});
console.log(
  `${totals.articles} articles added for ${totals.tickers} tickers in ${((performance.now() - started) / 60000).toFixed(1)} min`,
);
