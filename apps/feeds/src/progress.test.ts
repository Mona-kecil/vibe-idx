import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { cover, gaps, loadProgress, saveProgress } from './progress';

const window = { from: '2026-01-01', to: '2026-01-31' };

describe('what a backfill still has to ask', () => {
  it('is the whole window when nothing is covered', () => {
    expect(gaps(window, [])).toEqual([window]);
  });
  it('is nothing when the window is covered', () => {
    expect(gaps(window, [{ from: '2025-12-01', to: '2026-02-01' }])).toEqual([]);
  });
  it('is the older and the newer dates around what is covered', () => {
    expect(gaps(window, [{ from: '2026-01-10', to: '2026-01-20' }])).toEqual([
      { from: '2026-01-01', to: '2026-01-09' },
      { from: '2026-01-21', to: '2026-01-31' },
    ]);
  });
  it('skips covered ranges outside the window and joins touching ones', () => {
    const covered = [
      { from: '2025-01-01', to: '2025-06-30' },
      { from: '2026-01-01', to: '2026-01-15' },
      { from: '2026-01-16', to: '2026-01-20' },
    ];
    expect(gaps(window, covered)).toEqual([{ from: '2026-01-21', to: '2026-01-31' }]);
    expect(cover(covered.slice(1), { from: '2026-01-21', to: '2026-01-31' })).toEqual([window]);
  });
});

describe('saved progress', () => {
  const directory = () => mkdtemp(join(tmpdir(), 'backfill-progress-'));
  it('keeps what each destination finished apart', async () => {
    const file = join(await directory(), 'progress.json');
    await saveProgress(file, 'r2:abc', { BBCA: [window] });
    await saveProgress(file, 'directory:/a', { TLKM: [window] });
    expect(await loadProgress(file, 'r2:abc')).toEqual({ BBCA: [window] });
    expect(await loadProgress(file, 'directory:/a')).toEqual({ TLKM: [window] });
    expect(await loadProgress(file, 'directory:/b')).toEqual({});
  });
  it('starts empty when there is no file and leaves no temporary file behind', async () => {
    const dir = await directory();
    const file = join(dir, 'progress.json');
    expect(await loadProgress(file, 'r2:abc')).toEqual({});
    await saveProgress(file, 'r2:abc', {});
    expect(await readdir(dir)).toEqual(['progress.json']);
  });
  it('refuses a truncated file and says how to go on', async () => {
    const file = join(await directory(), 'progress.json');
    await writeFile(file, '{"version":1,"destinations":{"r2:abc":{"BBCA":[{"from":"2026-01');
    await expect(loadProgress(file, 'r2:abc')).rejects.toThrow('--restart');
    await expect(saveProgress(file, 'r2:abc', {})).rejects.toThrow('--restart');
    expect(await readFile(file, 'utf8')).toContain('"BBCA"');
  });
  it('starts over on request and replaces the unreadable file', async () => {
    const file = join(await directory(), 'progress.json');
    await writeFile(file, '{"version":1,"dest');
    expect(await loadProgress(file, 'r2:abc', true)).toEqual({});
    await saveProgress(file, 'r2:abc', { BBCA: [window] }, true);
    expect(await loadProgress(file, 'r2:abc')).toEqual({ BBCA: [window] });
  });
});
