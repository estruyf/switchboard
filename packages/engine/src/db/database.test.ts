import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppStateStore } from './appState.ts';
import { openCacheDatabase, schemaVersion } from './database.ts';
import { migrations } from './migrations.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-db-'));
  dirs.push(dir);
  return dir;
};

describe('cache database', () => {
  it('creates the full schema and records its version', () => {
    const cache = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    expect(schemaVersion(cache.db)).toBe(migrations.length);
    const tables = (cache.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['projects', 'sessions', 'transcript_fts', 'transcript_indexed', 'project_actions', 'trusted_commands', 'app_state']));
    expect(cache.recovered).toBe(false);
    cache.close();
  });

  it('reopens an existing database without re-running migrations', () => {
    const path = join(tempDir(), 'cache.sqlite');
    const first = openCacheDatabase(path);
    createAppStateStore(first.db).set('k', 1);
    first.close();
    const second = openCacheDatabase(path);
    expect(createAppStateStore(second.db).get('k')).toBe(1);
    expect(second.recovered).toBe(false);
    second.close();
  });

  it('moves a corrupt file aside and rebuilds', () => {
    const dir = tempDir();
    const path = join(dir, 'cache.sqlite');
    writeFileSync(path, 'this is not a sqlite file, just garbage bytes '.repeat(200));
    const cache = openCacheDatabase(path);
    expect(cache.recovered).toBe(true);
    expect(schemaVersion(cache.db)).toBe(migrations.length);
    expect(readdirSync(dir).some((f) => f.startsWith('cache.sqlite.broken-'))).toBe(true);
    cache.close();
  });

  it('supports full-text search', () => {
    const cache = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    cache.db.prepare('INSERT INTO transcript_fts (session_id, uuid, role, at, text) VALUES (?, ?, ?, ?, ?)').run('s1', 'u1', 'user', null, 'Please rewind the worktree changes');
    const hits = cache.db.prepare("SELECT session_id FROM transcript_fts WHERE transcript_fts MATCH 'rewinding'").all();
    expect(hits).toEqual([{ session_id: 's1' }]);
    cache.close();
  });
});

describe('app state', () => {
  it('round-trips JSON values and returns null for missing keys', () => {
    const cache = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    const state = createAppStateStore(cache.db);
    expect(state.get('missing')).toBeNull();
    state.set('prefs', { editor: 'vscode', recent: ['/a', '/b'], zoom: 1.1, compact: false });
    expect(state.get('prefs')).toEqual({ editor: 'vscode', recent: ['/a', '/b'], zoom: 1.1, compact: false });
    state.set('prefs', 'replaced');
    expect(state.get('prefs')).toBe('replaced');
    cache.close();
  });
});
