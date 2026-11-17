import { WriteConflict, type Bucket } from './bucket';

/**
 * A bucket in memory with R2's conditional writes, for tests and local runs. `before` runs ahead of every call, so
 * a test can fail a write or hold one while another writer goes first.
 */
export function memoryBucket(
  before: (call: 'get' | 'put', key: string) => Promise<void> | void = () => {},
) {
  const files = new Map<string, { text: string; etag: string }>();
  const puts: string[] = [];
  let version = 0;
  const bucket: Bucket = {
    async get(key) {
      await before('get', key);
      const file = files.get(key);
      return file
        ? { etag: file.etag, json: async (): Promise<unknown> => JSON.parse(file.text) }
        : null;
    },
    async put(key, value, { only }) {
      await before('put', key);
      const file = files.get(key);
      if (only && ('absent' in only ? file : file?.etag !== only.match))
        throw new WriteConflict(key);
      const etag = `"v${++version}"`;
      puts.push(key);
      files.set(key, { text: value, etag });
      return { etag };
    },
  };
  const text = (key: string) => files.get(key)?.text;
  const set = (key: string, value: string) =>
    files.set(key, { text: value, etag: `"v${++version}"` });
  return { bucket, files, puts, text, set };
}
