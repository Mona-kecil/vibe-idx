import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { localR2 } from './local-r2';

let bucket: string;
beforeEach(async () => {
  bucket = await mkdtemp(join(tmpdir(), 'local-r2-'));
});
afterEach(() => rm(bucket, { recursive: true, force: true }));

const bytes = (text: string) => Buffer.from(text);

describe('localR2', () => {
  it('reads back what was put, with a stable ETag', async () => {
    const r2 = localR2(bucket, async () => undefined);
    const etag = await r2.put('site/a.json', bytes('one'));
    expect(await r2.get('site/a.json')).toEqual({ bytes: bytes('one'), etag });
  });

  it('falls back to the source for keys it does not hold, without writing them', async () => {
    const r2 = localR2(bucket, async (key) =>
      key === 'ticks/x.parquet' ? bytes('src') : undefined,
    );
    expect((await r2.get('ticks/x.parquet'))?.bytes).toEqual(bytes('src'));
    expect(await r2.get('missing')).toBeUndefined();
    await r2.delete('ticks/x.parquet');
    expect((await r2.get('ticks/x.parquet'))?.bytes).toEqual(bytes('src'));
  });

  it('fails a create-only put when the key exists, as R2 does', async () => {
    const r2 = localR2(bucket, async () => undefined);
    await r2.put('site/a.json', bytes('one'), { ifNoneMatch: '*' });
    await expect(r2.put('site/a.json', bytes('two'), { ifNoneMatch: '*' })).rejects.toThrow(
      'R2 HTTP 412',
    );
  });

  it('fails a put whose expected ETag is stale, and takes a current one', async () => {
    const r2 = localR2(bucket, async () => undefined);
    const first = await r2.put('site/a.json', bytes('one'));
    await r2.put('site/a.json', bytes('two'), { ifMatch: first });
    await expect(r2.put('site/a.json', bytes('three'), { ifMatch: first })).rejects.toThrow(
      'R2 HTTP 412',
    );
    expect((await r2.get('site/a.json'))?.bytes).toEqual(bytes('two'));
  });
});
