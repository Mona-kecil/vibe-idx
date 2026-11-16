import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { checkout } from './checkout';
import { alive, cliErrors, plural } from './cli';
import { cutBrokerData, fixturePaths, lockHolder, takeLock, fixtureStateSchema } from './local-r2';

const usage = `pnpm bench:publish [--base <git ref>] [--step <step>]... [--runs N] [--date <session>]

Times the publication code on the fixtures and reports median time, peak memory and an output digest per side.
With --base it runs that ref too, alternating sides run by run. One runs at a time on the machine; a second waits.
It reads the fixtures without changing them, so it shares them safely with the other dev commands.

--step     broker          broker files as of the as-of session, about a minute a run
           ticks           running trade and the order book of --date
           running_trade   running trade of --date alone
           closing_book    the order book of --date alone
           broker and ticks by default
--runs     runs per side, 5 by default; 3 or more to compare times
--date     the session for the tick steps, the as-of session by default`;
cliErrors();
const { values: args } = parseArgs({
  options: {
    base: { type: 'string' },
    step: { type: 'string', multiple: true, default: [] },
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
const stepSchema = z.enum(['broker', 'ticks', 'running_trade', 'closing_book']);
type Step = z.infer<typeof stepSchema>;
const steps: Step[] = args.step.length
  ? args.step.map((step) => stepSchema.parse(step))
  : ['broker', 'ticks'];
const paths = fixturePaths();
if (!existsSync(paths.state))
  throw new Error(`No fixtures in ${paths.root}. Run \`pnpm fixtures\` first.`);
const state = fixtureStateSchema.parse(JSON.parse(await readFile(paths.state, 'utf8')));
const date = z.iso.date().parse(args.date ?? state.asOf);
if (!state.sessions.includes(date))
  throw new Error(`${date} is not a fixture session. Sessions: ${state.sessions.join(' ')}`);
const stepTitle: Record<Step, string> = {
  broker: `broker files as of ${state.asOf}`,
  ticks: `running trade and order book ${date}`,
  running_trade: `running trade ${date}`,
  closing_book: `order book ${date}`,
};
for (const dataset of ['running_trade', 'closing_book'] as const)
  if (steps.includes(dataset) && !existsSync(join(paths.cache, `ticks/${dataset}/${date}.parquet`)))
    throw new Error(
      `The fixtures have no ${dataset === 'closing_book' ? 'order book' : 'running trade'} for ${date}.`,
    );
const writer = lockHolder('fixtures');
if (writer)
  throw new Error(
    `\`pnpm fixtures\` (pid ${writer}) is rewriting the fixtures. Wait for it to finish.`,
  );
await takeLock('bench');

// Each benchmark works in its own folder, so two can run at once; folders of finished processes go.
const benches = join(paths.root, 'bench');
for (const pid of existsSync(benches) ? await readdir(benches) : [])
  if (!alive(Number(pid))) await rm(join(benches, pid), { recursive: true, force: true });
const bench = join(benches, String(process.pid));
process.once('exit', () => rmSync(bench, { recursive: true, force: true }));
const brokerData = join(bench, 'broker');
const run = join(bench, 'run');

// What the machine uses with no benchmark running, so a run can tell extra work from its usual background.
const idleBusy = busySeconds();
await new Promise((done) => setTimeout(done, 2000));
const idleAfter = busySeconds();
const baseline =
  idleBusy === undefined || idleAfter === undefined
    ? undefined
    : (idleAfter - idleBusy) / (cpus().length * 2);
console.log(
  `${cpus().length} cores${baseline === undefined ? '' : `, ${(baseline * 100).toFixed(0)}% busy before starting`}, ${plural(runs, 'run')} per side${args.base ? ', alternating' : ''}`,
);
// Work already running before the start can slow every run alike, which a comparison against the baseline misses.
const busyStart = baseline !== undefined && baseline > 0.25;
if (busyStart)
  console.warn(
    `The machine was ${(baseline * 100).toFixed(0)}% busy before starting, so every run may be slowed. Close other work for a clean number.`,
  );

if (steps.includes('broker')) {
  const year = state.asOf.slice(0, 4);
  const sources = [
    join(paths.cache, `parquet/broker_activity/${year}.parquet`),
    join(paths.cache, 'parquet/broker-activity-coverage.parquet'),
  ] as const;
  if (!sources.every(existsSync))
    throw new Error('Broker sources are missing. Run `pnpm fixtures` first.');
  await cutBrokerData(...sources, state.asOf, brokerData);
}

const here = join(import.meta.dirname, '..');
const base = args.base ? await checkout(args.base) : undefined;
if (base) {
  // Working-tree changes count too, so an uncommitted edit to publication code is seen.
  const touched = execFileSync(
    'git',
    [
      'diff',
      '--name-only',
      base.sha,
      '--',
      ':(glob)apps/pipeline/**/*.ts',
      ':(exclude)apps/pipeline/dev',
      ':(exclude)*.test.ts',
    ],
    { cwd: join(here, '../..') },
  )
    .toString()
    .trim();
  console.log(
    touched
      ? `pipeline sources that differ from ${base.label}: ${touched.split('\n').join(', ')}`
      : `no pipeline source differs from ${base.label} outside dev tools and tests, so both sides should time the same`,
  );
}
const sides = [
  ...(base ? [{ label: base.label, pipeline: join(base.dir, 'apps/pipeline') }] : []),
  { label: 'this checkout', pipeline: here },
];
const resultSchema = z.object({
  seconds: z.number(),
  peakMB: z.number(),
  files: z.number(),
  digest: z.string(),
  cpuSeconds: z.number(),
});
type Result = z.infer<typeof resultSchema> & { others: number | undefined };

/** CPU seconds the whole machine has spent busy, from Linux's counters; undefined elsewhere. */
function busySeconds() {
  if (!existsSync('/proc/stat')) return undefined;
  const ticks = readFileSync('/proc/stat', 'utf8')
    .split('\n')[0]!
    .trim()
    .split(/\s+/)
    .slice(1)
    .map(Number);
  const idle = ticks[3]! + ticks[4]!;
  return (ticks.reduce((sum, tick) => sum + tick, 0) - idle) / 100;
}

function once(pipeline: string, step: Step): Result {
  const busy = busySeconds();
  const started = performance.now();
  const child = spawnSync(
    join(here, 'node_modules/.bin/tsx'),
    [join(import.meta.dirname, 'bench-run.ts'), pipeline, step, date, run, brokerData],
    { encoding: 'utf8', maxBuffer: 1 << 26 },
  );
  if (child.status !== 0) throw new Error(`${step} run failed:\n${child.stderr || child.stdout}`);
  const result = resultSchema.parse(JSON.parse(child.stdout.trim().split('\n').at(-1)!));
  const wall = (performance.now() - started) / 1000;
  const after = busySeconds();
  // What the rest of the machine used while this run went, as a share of all its cores.
  const others =
    busy === undefined || after === undefined
      ? undefined
      : Math.max(0, after - busy - result.cpuSeconds) / (cpus().length * wall);
  return { ...result, others };
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
        await rm(run, { recursive: true, force: true });
        const result = once(side.pipeline, step);
        results.get(side.label)!.push(result);
        console.warn(
          `${step} run ${i + 1} of ${runs}, ${side.label}: ${result.seconds.toFixed(1)}s`,
        );
      }
    console.log(`\n${stepTitle[step]}`);
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
    let differs = false;
    if (before && after) {
      const change = (after.time / before.time - 1) * 100;
      const separate = after.high < before.low || after.low > before.high;
      differs = runs >= 3 && separate;
      // With one or two runs a side, a gap between the ranges says little about the code.
      const verdict =
        runs < 3
          ? `${plural(runs, 'run')} per side is too few to tell a difference in time; use --runs 3 or more`
          : separate
            ? `${Math.abs(change).toFixed(0)}% ${change < 0 ? 'faster' : 'slower'}`
            : 'no measurable difference in time: the ranges overlap';
      console.log(
        `${verdict}, peak memory ${after.peak - before.peak >= 0 ? '+' : ''}${(after.peak - before.peak).toLocaleString('en')} MB, ${after.digest === before.digest ? 'same output' : 'OUTPUT DIFFERS'}`,
      );
    }
    const others = [...results.values()]
      .flat()
      .flatMap((r) => (r.others === undefined ? [] : [r.others]));
    if (others.length) {
      const worst = Math.max(...others);
      const start = `${((baseline ?? 0) * 100).toFixed(0)}% before starting`;
      const noisy = worst > (baseline ?? 0) + 0.1 || busyStart;
      // Noise widens the ranges: it can hide a small difference, or make one where the ranges barely separate.
      const meaning = !noisy
        ? ''
        : !before || !after
          ? ', so the times may run high'
          : differs
            ? ', so the difference may come from the other work; rerun on a quiet machine to confirm it'
            : ', so a difference smaller than the ranges could be hidden';
      console.log(
        `${
          worst > (baseline ?? 0) + 0.1
            ? `other processes used up to ${(worst * 100).toFixed(0)}% of the machine during a run, against ${start}`
            : `other processes stayed near the ${start}${busyStart ? ', which is high enough to slow every run' : ''}`
        }${meaning}`,
      );
    }
  }
} finally {
  base?.remove();
}
