import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

export type SqliteDatabase = Database.Database;

const serverDir = dirname(fileURLToPath(import.meta.url));

export function resolveDatabasePath(databaseUrl = process.env.VIBE_IDX_DATABASE_URL) {
  if (databaseUrl?.startsWith('sqlite:///')) {
    return databaseUrl.slice('sqlite:///'.length);
  }

  if (databaseUrl && !databaseUrl.includes('://')) {
    return databaseUrl;
  }

  return resolve(serverDir, '../../../../data/vibe_idx.sqlite');
}

export function withReadonlyDatabase<T>(
  databaseUrl: string | undefined,
  read: (database: SqliteDatabase) => T,
) {
  const databasePath = resolveDatabasePath(databaseUrl);

  if (!existsSync(databasePath)) {
    throw new Error(`SQLite database not found at ${databasePath}`);
  }

  const database = new Database(databasePath, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    return read(database);
  } finally {
    database.close();
  }
}
