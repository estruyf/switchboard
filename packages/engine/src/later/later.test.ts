import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCacheDatabase } from '../db/database.ts';
import { LaterStore } from './laterStore.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const cachePath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-later-'));
  dirs.push(dir);
  return join(dir, 'cache.sqlite');
};

describe('Later list', () => {
  it('saves a prompt with the choices it would start with, and fills in the rest', () => {
    const cache = openCacheDatabase(cachePath());
    const later = new LaterStore(cache.db);
    const item = later.add({ cwd: '/work/web', prompt: 'Add a yearly overview page', model: 'opus', workspace: 'worktree', profileId: 'work' });
    expect(item).toMatchObject({
      cwd: '/work/web',
      prompt: 'Add a yearly overview page',
      model: 'opus',
      effort: null,
      permissionMode: 'default',
      workspace: 'worktree',
      baseRef: 'fresh',
      branch: null,
      profileId: 'work',
    });
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(later.list()).toEqual([item]);
    cache.close();
  });

  it('lists newest first, all of them or one project', () => {
    const cache = openCacheDatabase(cachePath());
    const later = new LaterStore(cache.db);
    const a = later.add({ cwd: '/work/web', prompt: 'First' }, { createdAt: 1 });
    const b = later.add({ cwd: '/work/api', prompt: 'Second' }, { createdAt: 2 });
    const c = later.add({ cwd: '/work/web', prompt: 'Third' }, { createdAt: 3 });
    expect(later.list().map((i) => i.id)).toEqual([c.id, b.id, a.id]);
    expect(later.list('/work/web').map((i) => i.prompt)).toEqual(['Third', 'First']);
    expect(later.list('/work/api').map((i) => i.prompt)).toEqual(['Second']);
    expect(later.list('/work/other')).toEqual([]);
    cache.close();
  });

  it('removes an item, and Undo puts it back in its place', () => {
    const cache = openCacheDatabase(cachePath());
    const later = new LaterStore(cache.db);
    const older = later.add({ cwd: '/work/web', prompt: 'Older' }, { createdAt: 1 });
    const removed = later.add({ cwd: '/work/web', prompt: 'Middle', effort: 'high' }, { createdAt: 2 });
    later.add({ cwd: '/work/web', prompt: 'Newer' }, { createdAt: 3 });
    later.remove(removed.id);
    expect(later.list().map((i) => i.prompt)).toEqual(['Newer', 'Older']);
    const { id, createdAt, ...draft } = removed;
    expect(later.add(draft, { id, createdAt })).toEqual(removed);
    expect(later.list().map((i) => i.prompt)).toEqual(['Newer', 'Middle', 'Older']);
    // Removing something that is already gone is fine.
    later.remove('missing');
    later.remove(older.id);
    expect(later.list()).toHaveLength(2);
    cache.close();
  });

  it('refuses an empty prompt or a relative folder', () => {
    const cache = openCacheDatabase(cachePath());
    const later = new LaterStore(cache.db);
    expect(() => later.add({ cwd: '/work/web', prompt: '   ' })).toThrow();
    expect(() => later.add({ cwd: 'work/web', prompt: 'Hi' })).toThrow();
    expect(later.list()).toEqual([]);
    cache.close();
  });

  it('survives a cache rebuild and a restart', () => {
    const path = cachePath();
    const first = openCacheDatabase(path);
    const saved = new LaterStore(first.db).add({ cwd: '/work/web', prompt: 'Keep me', branch: 'feature/a' });
    // What a rebuild throws away: the session cache and the search index, all derived from ~/.claude.
    first.db.exec('DELETE FROM sessions; DELETE FROM transcript_fts; DELETE FROM transcript_indexed;');
    first.close();
    const second = openCacheDatabase(path);
    expect(new LaterStore(second.db).list()).toEqual([saved]);
    second.close();
  });

  it('skips a row it cannot read instead of failing the list', () => {
    const cache = openCacheDatabase(cachePath());
    const later = new LaterStore(cache.db);
    later.add({ cwd: '/work/web', prompt: 'Fine' }, { createdAt: 1 });
    cache.db.prepare('INSERT INTO later_prompts (id, cwd, prompt, settings_json, created_at) VALUES (?, ?, ?, ?, ?)').run('odd', '/work/web', 'Odd', '{"permissionMode":"sideways"}', 5);
    cache.db.prepare('INSERT INTO later_prompts (id, cwd, prompt, settings_json, created_at) VALUES (?, ?, ?, ?, ?)').run('broken', '/work/web', 'Broken', 'not json', 6);
    // Unreadable settings fall back to the defaults; an invalid value drops the row.
    expect(later.list().map((i) => i.prompt)).toEqual(['Broken', 'Fine']);
    cache.close();
  });
});
