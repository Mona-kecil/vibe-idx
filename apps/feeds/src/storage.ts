import { AwsClient } from 'aws4fetch';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Bucket } from './collector';

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
  return {
    async get(key) {
      const response = await request(key, { method: 'GET' });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`R2 read HTTP ${response.status}`);
      return { json: async (): Promise<unknown> => response.json() };
    },
    async put(key, value, { httpMetadata }) {
      const response = await request(key, {
        method: 'PUT',
        headers: {
          'Content-Type': httpMetadata.contentType,
          'Cache-Control': httpMetadata.cacheControl,
        },
        body: value,
      });
      if (!response.ok) throw new Error(`R2 write HTTP ${response.status}`);
      await response.body?.cancel();
    },
  };
}

/** A folder standing in for the public bucket, for runs that must not reach the real one. */
export function directoryBucket(root: string): Bucket {
  return {
    async get(key) {
      const text = await readFile(join(root, key), 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      return text === null ? null : { json: async (): Promise<unknown> => JSON.parse(text) };
    },
    async put(key, value) {
      const file = join(root, key);
      await mkdir(dirname(file), { recursive: true });
      const partial = `${file}.${process.pid}.tmp`;
      await writeFile(partial, value);
      await rename(partial, file);
    },
  };
}
