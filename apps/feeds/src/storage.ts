import { AwsClient } from 'aws4fetch';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { WriteConflict, type Bucket } from './bucket';

export function r2Bucket({
  accountId,
  accessKeyId,
  secretAccessKey,
  fetcher = fetch,
}: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetcher?: typeof fetch;
}): Bucket {
  const signer = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  async function request(key: string, init: RequestInit) {
    return fetcher(
      await signer.sign(
        `https://${accountId}.r2.cloudflarestorage.com/vibe-idx-public/${key.split('/').map(encodeURIComponent).join('/')}`,
        { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) },
      ),
    );
  }
  const bucket: Bucket = {
    async get(key) {
      // R2 weakens the ETag when compressing JSON; If-Match needs the stored object's strong ETag.
      const response = await request(key, {
        method: 'GET',
        headers: { 'Accept-Encoding': 'identity' },
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`R2 read HTTP ${response.status}`);
      const etag = response.headers.get('etag');
      if (!etag) throw new Error('R2 read returned no ETag');
      return { etag, json: async (): Promise<unknown> => response.json() };
    },
    async put(key, value, { httpMetadata, only }) {
      const response = await request(key, {
        method: 'PUT',
        headers: {
          'Content-Type': httpMetadata.contentType,
          'Cache-Control': httpMetadata.cacheControl,
          ...(only && ('absent' in only ? { 'If-None-Match': '*' } : { 'If-Match': only.match })),
        },
        body: value,
      });
      // 412 is a failed condition. 409 is R2 refusing a conditional write while another write to the key is in flight.
      if (response.status === 412 || response.status === 409) {
        await response.body?.cancel();
        throw new WriteConflict(key);
      }
      if (!response.ok) throw new Error(`R2 write HTTP ${response.status}`);
      await response.body?.cancel();
      const etag = response.headers.get('etag') ?? (await bucket.get(key))?.etag;
      if (!etag) throw new Error('R2 write returned no ETag');
      return { etag };
    },
  };
  return bucket;
}

const lockStale = 30000;

/**
 * A folder standing in for the public bucket, for runs that must not reach the real one. A file's version is the
 * hash of its text, and a conditional write holds a lock folder while it compares and renames, so two processes
 * on one folder get R2's guarantee.
 */
export function directoryBucket(root: string): Bucket {
  const etagOf = (text: string) => `"${createHash('sha256').update(text).digest('hex')}"`;
  const read = (file: string) =>
    readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  async function locked<T>(file: string, work: () => Promise<T>): Promise<T> {
    const lock = `${file}.lock`;
    for (;;) {
      try {
        await mkdir(lock);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const age = await stat(lock).then(
          (s) => Date.now() - s.mtimeMs,
          () => 0,
        );
        if (age > lockStale) await rm(lock, { recursive: true, force: true });
        else await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    try {
      return await work();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
  return {
    async get(key) {
      const text = await read(join(root, key));
      return text === null
        ? null
        : { etag: etagOf(text), json: async (): Promise<unknown> => JSON.parse(text) };
    },
    async put(key, value, { only }) {
      const file = join(root, key);
      await mkdir(dirname(file), { recursive: true });
      const write = async () => {
        const partial = `${file}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(partial, value);
        await rename(partial, file);
        return { etag: etagOf(value) };
      };
      if (!only) return write();
      return locked(file, async () => {
        const current = await read(file);
        if (
          'absent' in only ? current !== null : current === null || etagOf(current) !== only.match
        )
          throw new WriteConflict(key);
        return write();
      });
    },
  };
}
