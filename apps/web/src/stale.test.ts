import { describe, expect, it } from 'vite-plus/test';
import { staleSince } from './data';

const health = (run_at: string) => ({
  prices: '2026-11-06',
  indices: '2026-11-06',
  five_pct: '2026-11-06',
  one_pct: '2026-10-30',
  issuers: '2026-11-06',
  run_at,
});

describe('staleSince', () => {
  const run = health('2026-11-06 10:28:11.799509+00');
  it('stays fresh until the next day check after that run', () => {
    expect(staleSince(run, Date.parse('2026-11-06T10:40:00Z'))).toBeNull();
    expect(staleSince(run, Date.parse('2026-11-07T11:59:00Z'))).toBeNull();
  });
  it('marks a snapshot stale once a daily run is missed', () => {
    expect(staleSince(run, Date.parse('2026-11-07T12:00:00Z'))).toBe('2026-11-06');
    expect(staleSince(run, Date.parse('2026-11-09T05:00:00Z'))).toBe('2026-11-06');
  });
  it('does not mark a late run published before the check as stale', () => {
    expect(
      staleSince(health('2026-11-07 10:55:00+00'), Date.parse('2026-11-07T12:00:00Z')),
    ).toBeNull();
  });
});
