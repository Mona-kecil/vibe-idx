import { AwsClient } from 'aws4fetch';
import type { Bucket } from './collector';

export function r2Bucket({
  accountId,
  accessKeyId,
  secretAccessKey,
  bucketName = 'vibe-idx-public',
  fetcher = fetch,
}: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName?: 'vibe-idx-public' | 'vibe-idx-private';
  fetcher?: typeof fetch;
}): Bucket {
  const signer = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  async function request(key: string, init: RequestInit) {
    return fetcher(
      await signer.sign(
        `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${encodeURIComponent(key)}`,
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
