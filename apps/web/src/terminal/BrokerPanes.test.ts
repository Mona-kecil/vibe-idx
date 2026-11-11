import { describe, expect, it } from 'vite-plus/test';
import { zeroCenteredAutoscale } from './BrokerPanes';

describe('foreign flow scales', () => {
  it.each([
    { minValue: -40e9, maxValue: 26e9 },
    { minValue: -3e9, maxValue: 60e9 },
    { minValue: -8e12, maxValue: -2e12 },
    { minValue: 2e12, maxValue: 8e12 },
    { minValue: 0, maxValue: 0 },
  ])('keeps zero halfway up each axis without clipping %o', (range) => {
    const result = zeroCenteredAutoscale(() => ({ priceRange: range }));
    expect(result?.priceRange).toBeTruthy();
    if (!result?.priceRange) return;
    const { minValue, maxValue } = result.priceRange;
    expect(minValue).toBeLessThanOrEqual(range.minValue);
    expect(maxValue).toBeGreaterThanOrEqual(range.maxValue);
    expect(maxValue).toBeGreaterThan(minValue);
    expect(-minValue / (maxValue - minValue)).toBe(0.5);
  });

  it('leaves an empty visible range empty', () => {
    expect(zeroCenteredAutoscale(() => null)).toBeNull();
    expect(zeroCenteredAutoscale(() => ({ priceRange: null }))).toBeNull();
  });
});
