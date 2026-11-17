import { expect, it } from 'vite-plus/test';
import { summarize, verdict, type Run } from './terminal-perf-verdict.js';

function runs(times: number[], errors = 0, rows = 30): Run[] {
  return times.map((longest) => [
    { step: 'boot', longest: 900, blocking: 800, errors: 0, requests: 10, rows },
    { step: 'tab', longest, blocking: Math.max(0, longest - 50), errors, requests: 1, rows },
  ]);
}
it('excludes boot, reports medians and ranges, and does not round before comparing', () => {
  const result = summarize(runs([100.1, 80, 110, 90, 105]));
  expect(result.score).toBe(100.1);
  expect(result.steps[1]!.longest).toEqual({ median: 100.1, low: 80, high: 110 });
  expect(result.steps[1]!.blocking.median).toBeCloseTo(50.1);
});
it('requires a gain beyond either run range', () => {
  const before = summarize(runs([100, 105, 110, 115, 120]));
  expect(verdict(before, summarize(runs([70, 75, 80, 85, 90])))).toBe('faster');
  expect(verdict(before, summarize(runs([90, 95, 100, 105, 110])))).toBe(
    'no measurable difference',
  );
  expect(verdict(summarize(runs([70, 75, 80, 85, 90])), before)).toBe('slower');
});
it('rejects errors and pages without rendered rows', () => {
  const before = summarize(runs([100, 101, 102]));
  expect(verdict(before, summarize(runs([0, 0, 0], 1)))).toBe('invalid');
  expect(verdict(before, summarize(runs([0, 0, 0], 0, 0)))).toBe('invalid');
});
