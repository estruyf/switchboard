import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations.ts';

export interface CacheDatabase {
  readonly db: DatabaseSync;
  readonly path: string;
  readonly sqliteVersion: string;
  /** True when an unreadable cache file was moved aside and rebuilt on open. */
  readonly recovered: boolean;
  close(): void;
}

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

function migrate(db: DatabaseSync): void {
  const current = schemaVersion(db);
  if (current > migrations.length) {
    throw new Error(`Cache schema v${current} is newer than this build (v${migrations.length})`);
  }
  for (let version = current; version < migrations.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function openAndMigrate(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 2000');
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Opens (or creates) the cache database. The cache can always be rebuilt from
 * ~/.claude, so a corrupt or incompatible file is moved aside rather than
 * blocking startup.
 */
export function openCacheDatabase(path: string): CacheDatabase {
  mkdirSync(dirname(path), { recursive: true });
  let db: DatabaseSync;
  let recovered = false;
  try {
    db = openAndMigrate(path);
  } catch {
    const aside = `${path}.broken-${Date.now()}`;
    renameSync(path, aside);
    for (const suffix of ['-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
    db = openAndMigrate(path);
    recovered = true;
  }
  const { version } = db.prepare('SELECT sqlite_version() AS version').get() as { version: string };
  return {
    db,
    path,
    sqliteVersion: version,
    recovered,
    close: () => db.close(),
  };
}
