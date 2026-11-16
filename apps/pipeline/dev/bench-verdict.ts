/** What `pnpm bench:publish` concludes from its runs, kept apart from the runs so tests can check the wording. */
import { plural } from './cli';

export type Side = {
  label: string;
  time: number;
  low: number;
  high: number;
  peak: number;
  files: number;
  digest: string;
};

export const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** A side's summary from its runs. A run whose output differs from the side's other runs is a bug in itself. */
export function side(
  label: string,
  runs: { seconds: number; peakMB: number; files: number; digest: string }[],
): Side {
  const times = runs.map((r) => r.seconds);
  const digests = new Set(runs.map((r) => r.digest));
  return {
    label,
    time: median(times),
    low: Math.min(...times),
    high: Math.max(...times),
    peak: Math.max(...runs.map((r) => r.peakMB)),
    files: runs[0]!.files,
    digest: digests.size === 1 ? runs[0]!.digest : `varies (${digests.size})`,
  };
}

/**
 * Before against after: a difference in time only when the ranges separate over three or more runs a side, since
 * with fewer a gap says little about the code. `differs` is that difference.
 */
export function verdict(before: Side, after: Side, runs: number) {
  const change = (after.time / before.time - 1) * 100;
  const separate = after.high < before.low || after.low > before.high;
  const time =
    runs < 3
      ? `${plural(runs, 'run')} per side is too few to tell a difference in time; use --runs 3 or more`
      : separate
        ? `${Math.abs(change).toFixed(0)}% ${change < 0 ? 'faster' : 'slower'}`
        : 'no measurable difference in time: the ranges overlap';
  const memory = after.peak - before.peak;
  return {
    differs: runs >= 3 && separate,
    line: `${time}, peak memory ${memory >= 0 ? '+' : ''}${memory.toLocaleString('en')} MB, ${after.digest === before.digest ? 'same output' : 'OUTPUT DIFFERS'}`,
  };
}

/** Above this share of the machine already busy before starting, every run may be slowed alike. */
export const busyStart = (baseline: number | undefined) =>
  baseline !== undefined && baseline > 0.25;

/**
 * What other work on the machine means for the timings. `worst` is the largest share of the machine other processes
 * used during a run and `baseline` the share before starting. Noise widens the ranges: it can hide a small
 * difference, or make one where the ranges barely separate. `differs` is undefined with one side.
 */
export function noiseLine(
  worst: number,
  baseline: number | undefined,
  differs: boolean | undefined,
) {
  const start = `${((baseline ?? 0) * 100).toFixed(0)}% before starting`;
  const rose = worst > (baseline ?? 0) + 0.1;
  const busy = busyStart(baseline);
  const meaning = !(rose || busy)
    ? ''
    : differs === undefined
      ? ', so the times may run high'
      : differs
        ? ', so the difference may come from the other work; rerun on a quiet machine to confirm it'
        : ', so a difference smaller than the ranges could be hidden';
  return `${
    rose
      ? `other processes used up to ${(worst * 100).toFixed(0)}% of the machine during a run, against ${start}`
      : `other processes stayed near the ${start}${busy ? ', which is high enough to slow every run' : ''}`
  }${meaning}`;
}
