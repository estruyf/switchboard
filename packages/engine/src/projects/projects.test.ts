import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCacheDatabase } from '../db/database.ts';
import { detectIconPath, MAX_ICON_BYTES } from './projectIcons.ts';
import { ProjectRegistry } from './projectRegistry.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-projects-')));
  dirs.push(dir);
  return dir;
};
const file = (path: string, content = '<svg/>') => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};

describe('detectIconPath', () => {
  it('prefers a declared icon, then conventions, then workspace packages', () => {
    const root = tempDir();
    expect(detectIconPath(root)).toBeNull();
    file(join(root, 'apps', 'web', 'public', 'favicon.svg'));
    expect(detectIconPath(root)).toBe(join(root, 'apps', 'web', 'public', 'favicon.svg'));
    file(join(root, 'public', 'favicon.ico'), 'ico');
    expect(detectIconPath(root)).toBe(join(root, 'public', 'favicon.ico'));
    file(join(root, 'public', 'favicon.svg'));
    expect(detectIconPath(root)).toBe(join(root, 'public', 'favicon.svg'));
    file(join(root, 'media', 'brand.png'), 'png');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ icon: 'media/brand.png' }));
    expect(detectIconPath(root)).toBe(join(root, 'media', 'brand.png'));
  });

  it('skips files that are too large to send', () => {
    const root = tempDir();
    file(join(root, 'logo.svg'), 'x'.repeat(MAX_ICON_BYTES + 1));
    expect(detectIconPath(root)).toBeNull();
  });
});

describe('ProjectRegistry', () => {
  it('lists session folders and added folders with custom, detected or no icons', () => {
    const data = tempDir();
    const cache = openCacheDatabase(join(data, 'cache.sqlite'));
    const registry = new ProjectRegistry(cache.db, join(data, 'icons'));
    const withIcon = tempDir();
    file(join(withIcon, 'public', 'favicon.svg'));
    const plain = tempDir();
    registry.add(plain);

    const byRoot = () => Object.fromEntries(registry.list([withIcon]).map((p) => [p.root, p]));
    expect(byRoot()[withIcon]).toMatchObject({ iconSource: 'detected', added: false, icon: { kind: 'image' } });
    expect(byRoot()[withIcon]!.icon).toMatchObject({ dataUrl: expect.stringMatching(/^data:image\/svg\+xml;base64,/) });
    expect(byRoot()[plain]).toMatchObject({ icon: null, iconSource: null, added: true, exists: true });

    registry.setIcon(plain, { kind: 'emoji', value: '🚲' });
    expect(byRoot()[plain]).toMatchObject({ icon: { kind: 'emoji', value: '🚲' }, iconSource: 'custom' });
    const custom = join(tempDir(), 'mine.png');
    file(custom, 'png-bytes');
    registry.setIcon(withIcon, { kind: 'file', path: custom });
    rmSync(custom);
    expect(byRoot()[withIcon]).toMatchObject({ iconSource: 'custom', icon: { kind: 'image', dataUrl: expect.stringMatching(/^data:image\/png/) } });
    registry.setIcon(withIcon, { kind: 'none' });
    expect(byRoot()[withIcon]).toMatchObject({ icon: null });
    registry.setIcon(withIcon, { kind: 'auto' });
    expect(byRoot()[withIcon]).toMatchObject({ iconSource: 'detected' });

    registry.remove(plain);
    expect(byRoot()[plain]).toBeUndefined();
    expect(() => registry.add(join(plain, 'nope'))).toThrow(/Not a folder/);
    cache.close();
  });
});
