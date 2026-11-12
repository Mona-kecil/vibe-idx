import { describe, expect, it } from 'vite-plus/test';
import { areaChart, FLAT_CHANGE_PCT } from './area';

const chart = (
  values: number[],
  width = 100,
  height = 50,
  pad?: { top: number; bottom: number },
) => {
  const area = areaChart(values, width, height, pad);
  if (!area) throw new Error('Expected an area');
  return area;
};

describe('areaChart tone', () => {
  it.each([
    [[1000, 1000.5], 'flat'],
    [[1000, 999.5], 'flat'],
    [[1000, 1001], 'up'],
    [[1000, 999], 'down'],
    [[1000, 1200, 900, 1000], 'flat'],
    [[1000, 800, 1300, 1100], 'up'],
    [[1000, 1500, 1200, 900], 'down'],
  ] as const)('classifies %j as %s', (values, tone) => {
    expect(chart([...values]).tone).toBe(tone);
  });

  it('treats exactly the flat threshold as a move, on either side', () => {
    expect(FLAT_CHANGE_PCT).toBe(0.1);
    expect(chart([1000, 1001]).changePct).toBe(FLAT_CHANGE_PCT);
    expect(chart([1000, 1001]).tone).toBe('up');
    expect(chart([1000, 999]).changePct).toBe(-FLAT_CHANGE_PCT);
    expect(chart([1000, 999]).tone).toBe('down');
  });

  it('reports the change from the first value to the last', () => {
    expect(chart([200, 500, 150, 250])).toMatchObject({ change: 50, changePct: 25 });
  });
});

describe('areaChart degenerate input', () => {
  it('returns null for no values', () => {
    expect(areaChart([], 100, 50)).toBeNull();
  });

  it.each([[[42]], [[7, 7, 7, 7]]])('draws %j as a level line without NaN', (values) => {
    const area = chart(values, 100, 50, { top: 10, bottom: 10 });
    expect(area.line).not.toMatch(/NaN|Infinity/);
    expect(area.fill).not.toMatch(/NaN|Infinity/);
    expect(area).toMatchObject({ tone: 'flat', change: 0, changePct: 0 });
    expect(area.line).toMatch(/^M0,25 .*L100,25$/);
    expect(area.high.y).toBe(25);
    expect(area.low.y).toBe(25);
  });

  it('keeps a zero first value finite', () => {
    const area = chart([0, 5]);
    expect(area.changePct).toBe(0);
    expect(area.line).not.toMatch(/NaN|Infinity/);
  });
});

describe('areaChart geometry', () => {
  it('places the high and low inside the padding', () => {
    const area = chart([10, 30, 20, 0, 15], 400, 100, { top: 20, bottom: 10 });
    expect(area.high).toEqual({ x: 100, y: 20, value: 30 });
    expect(area.low).toEqual({ x: 300, y: 90, value: 0 });
  });

  it('keeps the first extreme when values tie', () => {
    const area = chart([5, 9, 1, 9, 1], 80, 40);
    expect(area.high.x).toBe(20);
    expect(area.low.x).toBe(40);
  });

  it('starts at x 0 and ends at the width, with the fill closed along the baseline', () => {
    const area = chart([3, 1, 2, 5], 120, 28);
    expect(area.line.startsWith('M0,')).toBe(true);
    expect(area.line).toMatch(/ L120,[\d.]+$/);
    expect(area.fill.startsWith(area.line)).toBe(true);
    expect(area.fill.endsWith('L120,28 L0,28 Z')).toBe(true);
  });

  it('puts higher values higher on screen', () => {
    const area = chart([1, 3, 2]);
    expect(area.high.y).toBeLessThan(area.low.y);
  });
});
