import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { backfill, lookback, politeGoogle, retag } from './src/backfill';
import { cover, gaps, loadProgress, saveProgress } from './src/progress';
import { directoryBucket, r2Bucket } from './src/storage';
import { tickerSchema } from './src/contracts';
import { tickerTagger } from './src/tagging';

const usage = `pnpm --filter @vibe-idx/feeds backfill --local [--dir DIR] | --r2 [--months 12] [--tickers BBCA,TLKM | --top 100] [--delay 3000] [--window-days 30] [--retag]

Fills the news archive back from Google News, one ticker at a time, through the merge the Feeds job uses, so a
rerun adds nothing. Run it from a machine Google News answers, not from a Cloudflare Worker.
--local       writes to the fixtures' public folder, VIBE_IDX_FIXTURES or ~/.cache/vibe-idx/local, as the
              public bucket's files; --dir DIR writes to DIR instead
--r2          writes to the real public bucket, with the Feeds job's R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and
              R2_SECRET_ACCESS_KEY; it never does so unless asked
--months N    how far back, 12 by default
--tickers     only these codes
--top N       only the N tickers with the highest value traded; they come first in any run
--window-days N  one request per ticker per N days, 30 by default: 13 requests per ticker for 12 months
--delay MS    between Google requests, 3000 by default; it backs off by itself on 429 and 503
--retag       with --local, tag the archive again with the current tagger and stop, without asking Google
--restart     forget the progress saved for this destination and ask Google again; also the way past an unreadable
              progress file
Progress is saved per ticker as the dates already asked, with the destination, in ~/.cache/vibe-idx/news-backfill.json.
A run that stops resumes where it stopped, and a longer --months or a later day asks only about the dates not yet done.`;

const { values: args } = parseArgs({
  options: {
    local: { type: 'boolean', default: false },
    dir: { type: 'string' },
    r2: { type: 'boolean', default: false },
    months: { type: 'string', default: '12' },
    tickers: { type: 'string' },
    top: { type: 'string' },
    delay: { type: 'string', default: '3000' },
    'window-days': { type: 'string', default: '30' },
    retag: { type: 'boolean', default: false },
    restart: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (args.help || args.local === args.r2) {
  console.log(usage);
  process.exit(args.help ? 0 : 1);
}

const fixtures = join(
  process.env.VIBE_IDX_FIXTURES ?? join(homedir(), '.cache/vibe-idx/local'),
  'public',
);
const directory = args.dir ?? fixtures;
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
const progressFile = join(homedir(), '.cache/vibe-idx/news-backfill.json');
const destination = args.r2 ? `r2:${process.env.R2_ACCOUNT_ID}` : `directory:${resolve(directory)}`;

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
const byValue = [...tickers].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
const chosen = (wanted ? byValue.filter((t) => wanted.includes(t.ticker)) : byValue).slice(
  0,
  args.top ? z.coerce.number().int().positive().parse(args.top) : undefined,
);
const missing = wanted?.filter((code) => !chosen.some((t) => t.ticker === code)) ?? [];
if (missing.length) throw new Error(`Not in tickers.json: ${missing.join(', ')}`);
const covered = await loadProgress(progressFile, destination, args.restart);

const window = lookback(now, z.coerce.number().int().min(1).max(24).parse(args.months));
console.log(
  `${args.r2 ? 'REAL BUCKET' : directory}  ${window.from}..${window.to}  ${chosen.filter((t) => gaps(window, covered[t.ticker] ?? []).length).length} tickers left`,
);
const started = performance.now();
const google = politeGoogle({
  delay: z.coerce.number().int().min(500).parse(args.delay),
  log: console.error,
});
let requests = 0;
const totals = await backfill({
  bucket,
  tickers: chosen,
  window,
  fetchPage: async (query) => {
    requests++;
    return google(query);
  },
  tag,
  now,
  covered,
  batch: 1,
  days: z.coerce.number().int().min(1).max(366).parse(args['window-days']),
  finished: async (done) => {
    for (const [code, windows] of Object.entries(done))
      covered[code] = windows.reduce(cover, covered[code] ?? []);
    await saveProgress(progressFile, destination, covered, args.restart);
  },
  log: (line) => console.log(line),
});
console.log(
  `${totals.articles} articles added for ${totals.tickers} tickers, ${requests} requests, ${((performance.now() - started) / 60000).toFixed(1)} min`,
);
