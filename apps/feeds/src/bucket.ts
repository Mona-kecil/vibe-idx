/** What a write requires of the object it replaces: the version read before, or no object at all. */
type Condition = { match: string } | { absent: true };

type PutOptions = {
  httpMetadata: { contentType: string; cacheControl: string };
  only?: Condition;
};

export type Bucket = {
  get(key: string): Promise<{ json(): Promise<unknown>; etag: string } | null>;
  put(key: string, value: string, options: PutOptions): Promise<{ etag: string }>;
};

/** A conditional write that found the object changed, or being changed, since it was read. */
export class WriteConflict extends Error {
  constructor(key: string) {
    super(`${key} changed since it was read`);
  }
}

/** Runs a read-decide-write round again from a fresh read each time another writer got in first. */
export async function retrying<T>(attempt: () => Promise<T>, rounds = 12): Promise<T> {
  for (let round = 1; ; round++)
    try {
      return await attempt();
    } catch (failure) {
      if (!(failure instanceof WriteConflict) || round >= rounds) throw failure;
    }
}
