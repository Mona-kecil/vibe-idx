import { describe, expect, it } from 'vite-plus/test';
import { noiseLine, side, verdict } from './bench-verdict';

const runs = (label: string, seconds: number[], digest = 'abc') =>
  side(
    label,
    seconds.map((s) => ({ seconds: s, peakMB: 100, files: 10, digest })),
  );

describe('side', () => {
  it('takes the median and range of its runs', () => {
    expect(runs('a', [5, 3, 4])).toMatchObject({ time: 4, low: 3, high: 5 });
  });

  it('flags runs whose output differs from each other', () => {
    const mixed = side('a', [
      { seconds: 1, peakMB: 1, files: 1, digest: 'x' },
      { seconds: 1, peakMB: 1, files: 1, digest: 'y' },
    ]);
    expect(mixed.digest).toBe('varies (2)');
  });
});

describe('verdict', () => {
  it('calls overlapping ranges no measurable difference', () => {
    expect(verdict(runs('a', [4, 5, 6]), runs('b', [4.5, 5.5, 6.5]), 3)).toEqual({
      differs: false,
      line: 'no measurable difference in time: the ranges overlap, peak memory +0 MB, same output',
    });
  });

  it('calls separated ranges faster or slower by the medians', () => {
    expect(verdict(runs('a', [10, 10, 10]), runs('b', [5, 5, 5]), 3)).toMatchObject({
      differs: true,
      line: expect.stringMatching(/^50% faster/),
    });
  });

  it('draws no conclusion from fewer than three runs a side', () => {
    expect(verdict(runs('a', [10]), runs('b', [5]), 1)).toMatchObject({
      differs: false,
      line: expect.stringMatching(/1 run per side is too few/),
    });
  });

  it('says loudly when the output differs', () => {
    expect(verdict(runs('a', [1, 1, 1], 'x'), runs('b', [1, 1, 1], 'y'), 3).line).toMatch(
      /OUTPUT DIFFERS/,
    );
  });
});

describe('noiseLine', () => {
  it('says only where other work stayed when the machine was quiet', () => {
    expect(noiseLine(0.05, 0.04, false)).toBe('other processes stayed near the 4% before starting');
  });

  it('warns that noise could hide a difference when the ranges overlap', () => {
    expect(noiseLine(0.6, 0.05, false)).toBe(
      'other processes used up to 60% of the machine during a run, against 5% before starting, so a difference smaller than the ranges could be hidden',
    );
  });

  it('warns that noise could have made a difference when the ranges separate', () => {
    expect(noiseLine(0.6, 0.05, true)).toMatch(/may come from the other work/);
  });

  it('counts a machine busy before starting as noise even when it stays busy', () => {
    expect(noiseLine(0.4, 0.38, false)).toMatch(
      /stayed near the 38% before starting, which is high enough to slow every run/,
    );
  });

  it('with one side, says only that times may run high', () => {
    expect(noiseLine(0.6, 0.05, undefined)).toMatch(/so the times may run high$/);
  });
});
