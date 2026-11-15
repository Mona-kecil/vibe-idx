import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { checkout } from './checkout';
import { cliErrors, plural } from './cli';
import { cutBrokerData, fixturePaths, fixtureStateSchema } from './local-r2';

const usage = `pnpm bench:publish [--base <git ref>] [--step broker|ticks] [--runs N] [--date <session>]

Times the publication code on the fixtures and reports median time, peak memory and an output digest per side.
With --base it runs that ref too, alternating sides run by run. Both steps, 5 runs and the as-of session by default.`;
cliErrors();
const { values: args } = parseArgs({
  options: {
    base: { type: 'string' },
    step: { type: 'string' },
    runs: { type: 'string', default: '5' },
    date: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});
if (args.help) {
  console.log(usage);
  process.exit(0);
}
const runs = z.coerce.number().int().positive().parse(args.runs);
const steps = args.step
  ? [z.enum(['broker', 'ticks']).parse(args.step)]
  : (['broker', 'ticks'] as const);
const paths = fixturePaths();
if (!existsSync(paths.state))
  throw new Error(`No fixtures in ${paths.root}. Run \`pnpm fixtures\` first.`);
const state = fixtureStateSchema.parse(JSON.parse(await readFile(paths.state, 'utf8')));
const date = z.iso.date().parse(args.date ?? state.asOf);
if (!state.sessions.includes(date))
  throw new Error(`${date} is not a fixture session. Sessions: ${state.sessions.join(' ')}`);

const load = loadavg()[0]!;
console.log(
  `load ${load.toFixed(1)} on ${cpus().length} cores${load > cpus().length / 2 ? ', busy: timings will be noisy' : ''}, ${plural(runs, 'run')} per side${args.base ? ', alternating' : ''}`,
);

if (steps.includes('broker')) {
  const year = state.asOf.slice(0, 4);
  const sources = [
    join(paths.cache, `parquet/broker_activity/${year}.parquet`),
    join(paths.cache, 'parquet/broker-activity-coverage.parquet'),
  ] as const;
  if (!sources.every(existsSync))
    throw new Error('Broker sources are missing. Run `pnpm fixtures` first.');
  await cutBrokerData(...sources, state.asOf, join(paths.root, 'bench/broker'));
}

const here = join(import.meta.dirname, '..');
const base = args.base ? await checkout(args.base) : undefined;
const sides = [
  ...(base ? [{ label: base.label, pipeline: join(base.dir, 'apps/pipeline') }] : []),
  { label: 'this checkout', pipeline: here },
];
const resultSchema = z.object({
  seconds: z.number(),
  peakMB: z.number(),
  files: z.number(),
  digest: z.string(),
});
type Result = z.infer<typeof resultSchema>;

function once(pipeline: string, step: string) {
  const run = join(paths.root, 'bench', `run-${process.pid}`);
  const child = spawnSync(
    join(here, 'node_modules/.bin/tsx'),
    [join(import.meta.dirname, 'bench-run.ts'), pipeline, step, date, run],
    { encoding: 'utf8', maxBuffer: 1 << 26 },
  );
  if (child.status !== 0) throw new Error(`${step} run failed:\n${child.stderr || child.stdout}`);
  return resultSchema.parse(JSON.parse(child.stdout.trim().split('\n').at(-1)!));
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

try {
  for (const step of steps) {
    const results = new Map<string, Result[]>(sides.map((side) => [side.label, []]));
    for (let i = 0; i < runs; i++)
      for (const side of sides) {
        // Each run starts from an empty bucket.
        await rm(join(paths.root, 'bench', `run-${process.pid}`), { recursive: true, force: true });
        results.get(side.label)!.push(once(side.pipeline, step));
      }
    console.log(
      `\n${step === 'broker' ? `broker files as of ${state.asOf}` : `running trade and order book ${date}`}`,
    );
    const rows = sides.map(({ label }) => {
      const list = results.get(label)!;
      const times = list.map((r) => r.seconds);
      const digests = new Set(list.map((r) => r.digest));
      return {
        label,
        time: median(times),
        low: Math.min(...times),
        high: Math.max(...times),
        peak: Math.max(...list.map((r) => r.peakMB)),
        files: list[0]!.files,
        // A run whose output differs from the side's other runs is a bug in itself.
        digest: digests.size === 1 ? list[0]!.digest : `varies (${digests.size})`,
      };
    });
    const width = Math.max(...rows.map((r) => r.label.length));
    console.log(`${''.padEnd(width)}  median    range            peak MB   files  output`);
    for (const r of rows)
      console.log(
        `${r.label.padEnd(width)}  ${`${r.time.toFixed(1)}s`.padStart(6)}  ${`${r.low.toFixed(1)} to ${r.high.toFixed(1)}s`.padEnd(15)}  ${r.peak.toLocaleString('en').padStart(7)}  ${r.files.toLocaleString('en').padStart(6)}  ${r.digest}`,
      );
    const [before, after] = rows;
    if (before && after) {
      const change = (after.time / before.time - 1) * 100;
      const separate = after.high < before.low || after.low > before.high;
      console.log(
        `${separate ? `${Math.abs(change).toFixed(0)}% ${change < 0 ? 'faster' : 'slower'}` : 'no measurable difference in time: the ranges overlap'}, peak memory ${after.peak - before.peak >= 0 ? '+' : ''}${(after.peak - before.peak).toLocaleString('en')} MB, ${after.digest === before.digest ? 'same output' : 'OUTPUT DIFFERS'}`,
      );
    }
  }
} finally {
  base?.remove();
  await rm(join(paths.root, 'bench'), { recursive: true, force: true });
}
