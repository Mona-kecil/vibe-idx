import { describe, expect, it } from 'vite-plus/test';
import { diskFull } from './cli';

const error = (message: string, fields: { code?: string; errno?: number; path?: string } = {}) =>
  Object.assign(new Error(message), fields);

describe('diskFull', () => {
  it('names the path and the room left when Node runs out of quota', () => {
    expect(
      diskFull(
        error('EDQUOT: disk quota exceeded, write', {
          code: 'EDQUOT',
          errno: -122,
          path: '/tmp/x/bucket/site/a.json',
        }),
        () => 5 * 2 ** 20,
      ),
    ).toBe(
      'Out of disk space writing /tmp/x/bucket/site/a.json, with 5 MB free there. Free some space there, or point VIBE_IDX_FIXTURES at a disk with room: a fixture build writes about 1 GB.',
    );
  });

  it('recognises a bare errno and a database IO error', () => {
    expect(diskFull(error('write error -122'))).toMatch(/^Out of disk space\. /);
    expect(
      diskFull(
        error('IO Error: Could not write file "/tmp/x/work/a.parquet": No space left on device'),
      ),
    ).toMatch(/^Out of disk space writing \/tmp\/x\/work\/a\.parquet\. /);
  });

  it('leaves other errors alone', () => {
    expect(
      diskFull(error('Missing from the private bucket: x', { code: 'ENOENT' })),
    ).toBeUndefined();
  });
});
