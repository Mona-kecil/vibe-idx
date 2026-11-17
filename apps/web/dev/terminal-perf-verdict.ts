import { median } from '../../pipeline/dev/bench-verdict.js';

export type Click = {
  step: string;
  longest: number;
  blocking: number;
  errors: number;
  requests: number;
  rows: number;
};
export type Run = Click[];
export const spread = (values: number[]) => ({
  median: median(values),
  low: Math.min(...values),
  high: Math.max(...values),
});
export function summarize(runs: Run[]) {
  const steps = runs[0]!.map(({ step }, i) => ({
    step,
    longest: spread(runs.map((run) => run[i]!.longest)),
    blocking: spread(runs.map((run) => run[i]!.blocking)),
    errors: runs.reduce((sum, run) => sum + run[i]!.errors, 0),
    requests: spread(runs.map((run) => run[i]!.requests)),
    rows: spread(runs.map((run) => run[i]!.rows)),
  }));
  return {
    steps,
    score: steps.slice(1).reduce((sum, step) => sum + step.longest.median, 0),
    scores: spread(runs.map((run) => run.slice(1).reduce((sum, click) => sum + click.longest, 0))),
    errors: steps.reduce((sum, step) => sum + step.errors, 0),
    worked: steps.every((step) => step.rows.low > 0),
  };
}
export function verdict(before: ReturnType<typeof summarize>, after: ReturnType<typeof summarize>) {
  if (before.errors || after.errors || !before.worked || !after.worked) return 'invalid';
  const noise = Math.max(
    before.scores.high - before.scores.low,
    after.scores.high - after.scores.low,
  );
  const delta = before.score - after.score;
  return delta > noise ? 'faster' : -delta > noise ? 'slower' : 'no measurable difference';
}
