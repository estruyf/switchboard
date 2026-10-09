import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appStateFake } from './testing.ts';
import { openCommand } from './editors.ts';
import { FileIndex, fuzzyScore, walk } from './files.ts';
import { ShellEnvironment } from './shellEnvironment.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-sys-')));
  dirs.push(dir);
  return dir;
};

describe('openCommand', () => {
  it('jumps to a line through the editor CLI when it is on PATH', () => {
    const bin = tempDir();
    writeFileSync(join(bin, 'code'), '#!/bin/sh\n');
    chmodSync(join(bin, 'code'), 0o755);
    expect(openCommand('vscode', '/repo/a.ts', 12, { PATH: bin }, false)).toEqual({ command: join(bin, 'code'), args: ['-g', '/repo/a.ts:12'] });
  });

  it('falls back to `open -a` without the CLI, and handles Finder and terminals', () => {
    expect(openCommand('cursor', '/repo', undefined, { PATH: '' }, true)).toEqual({ command: 'open', args: ['-a', 'Cursor', '/repo'] });
    expect(openCommand('finder', '/repo/a.ts', undefined, {}, false)).toEqual({ command: 'open', args: ['-R', '/repo/a.ts'] });
    expect(openCommand('terminal', '/repo/src/a.ts', undefined, {}, false)).toEqual({ command: 'open', args: ['-a', 'Terminal', '/repo/src'] });
    expect(() => openCommand('nope', '/x', undefined, {}, true)).toThrow(/Unknown editor/);
  });
});

describe('file search', () => {
  it('ranks basename matches first', () => {
    const files = ['src/components/sidebar/Sidebar.tsx', 'docs/side-notes.md', 'src/state/sidebarRows.ts'];
    const ranked = files
      .map((f) => ({ f, s: fuzzyScore(f, 'sidebar') }))
      .filter((x) => x.s !== null)
      .sort((a, b) => b.s! - a.s!)
      .map((x) => x.f);
    expect(ranked[0]).toBe('src/components/sidebar/Sidebar.tsx');
    expect(fuzzyScore('src/a.ts', 'zzz')).toBeNull();
    expect(fuzzyScore('src/engine/hostManager.ts', 'hstmgr')).not.toBeNull();
  });

  it('lists files outside git while skipping dependency folders', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(dir, 'src', 'main.ts'), '');
    writeFileSync(join(dir, 'node_modules', 'pkg', 'main.ts'), '');
    await expect(new FileIndex().search(dir, 'main', 10)).resolves.toEqual(['src/main.ts']);
  });

  it('resolves paths mentioned in a reply to files that exist', async () => {
    const home = tempDir();
    const dir = join(home, 'repo');
    mkdirSync(join(dir, 'src', 'search'), { recursive: true });
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'src', 'search', 'suggestions.ts'), '');
    writeFileSync(join(dir, 'src', 'index.ts'), '');
    writeFileSync(join(dir, 'docs', 'index.ts'), '');
    const index = new FileIndex();
    const paths = ['src/index.ts', './src/index.ts', join(dir, 'docs'), '~/repo/src/index.ts', 'suggestions.ts', 'search/suggestions.ts', 'index.ts', 'item.Description', '../repo/src/index.ts', 'nope/suggestions.ts'];
    expect(await index.resolve(dir, paths, home)).toEqual([
      join(dir, 'src', 'index.ts'),
      join(dir, 'src', 'index.ts'),
      join(dir, 'docs'),
      join(dir, 'src', 'index.ts'),
      // Found deeper in the project when exactly one file ends with the path.
      join(dir, 'src', 'search', 'suggestions.ts'),
      join(dir, 'src', 'search', 'suggestions.ts'),
      // Two files end with index.ts: no guess.
      null,
      null,
      join(dir, 'src', 'index.ts'),
      null,
    ]);
    // Without a folder only absolute and ~ paths resolve.
    expect(await index.resolve(null, ['src/index.ts', '~/repo/docs'], home)).toEqual([null, join(dir, 'docs')]);
  });

  it('walks shallow folders first, skips the home folder\'s Library and stops at its time budget', async () => {
    const home = tempDir();
    mkdirSync(join(home, 'Library', 'Caches'), { recursive: true });
    mkdirSync(join(home, 'code', 'deep'), { recursive: true });
    writeFileSync(join(home, 'Library', 'Caches', 'x.ts'), '');
    writeFileSync(join(home, 'notes.md'), '');
    writeFileSync(join(home, 'code', 'deep', 'a.ts'), '');
    expect((await walk(home, { home })).sort()).toEqual(['code/deep/a.ts', 'notes.md']);
    // Library is only skipped in the home folder itself.
    expect(await walk(join(home, 'Library'), { home })).toEqual(['Caches/x.ts']);
    // With no time left, the walk returns what it has instead of going on.
    expect(await walk(home, { home, budgetMs: -1 })).toEqual([]);
  });
});

describe('ShellEnvironment', () => {
  it('uses the cached PATH for lookups while the shell is still loading, and refreshes the cache', async () => {
    const store = appStateFake({ 'shell.path': '/cached/bin' });
    let finish!: () => void;
    const env = new ShellEnvironment(store, () => new Promise((resolve) => (finish = () => resolve({ shell: '/bin/zsh', env: { PATH: '/fresh/bin', SECRET: 'x' }, resolved: true, durationMs: 400 }))));
    expect((await env.forLookup()).PATH).toBe('/cached/bin');
    expect(await env.describe()).toMatchObject({ cached: true });
    finish();
    await env.ready;
    expect((await env.forLookup()).PATH).toBe('/fresh/bin');
    // Only PATH is persisted, never the rest of the environment.
    expect(store.dump()).toEqual({ 'shell.path': '/fresh/bin' });
  });
});
