import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountWatcher } from './accountWatcher.ts';
import { readAccount } from './profileStore.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe('AccountWatcher', () => {
  it('notices a login written after it started, even when the file is replaced', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-account-'));
    dirs.push(dir);
    const file = join(dir, '.claude.json');
    let calls = 0;
    const watcher = new AccountWatcher(() => [file], () => void calls++, 100);
    watcher.start();
    try {
      // Claude Code writes a temp file and renames it over the real one.
      writeFileSync(`${file}.tmp`, JSON.stringify({ oauthAccount: { emailAddress: 'work@example.com' } }));
      renameSync(`${file}.tmp`, file);
      await until(() => calls > 0);
      expect(readAccount(file)).toEqual({ email: 'work@example.com', organization: null });
    } finally {
      watcher.stop();
    }
  });

  it('picks up a folder created after it started', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sb-account-'));
    dirs.push(root);
    const file = join(root, 'later', '.claude.json');
    let calls = 0;
    const watcher = new AccountWatcher(() => [file], () => void calls++, 50);
    watcher.start();
    try {
      mkdirSync(join(root, 'later'));
      writeFileSync(file, '{}');
      await until(() => calls > 0);
    } finally {
      watcher.stop();
    }
  });
});
