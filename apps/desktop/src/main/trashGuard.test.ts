import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isTrashableRepoFile, isTrashableSessionPath } from './trashGuard.ts';

const config = '/Users/me/.claude';
const id = '11111111-2222-4333-8444-555555555555';

describe('isTrashableSessionPath', () => {
  it('allows a transcript and its subagent folder inside the projects folder', () => {
    expect(isTrashableSessionPath(`${config}/projects/-Users-me-app/${id}.jsonl`, config)).toBe(true);
    expect(isTrashableSessionPath(`${config}/projects/-Users-me-app/${id}`, config)).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isTrashableSessionPath(`${config}/projects/-Users-me-app`, config)).toBe(false);
    expect(isTrashableSessionPath(`${config}/settings.json`, config)).toBe(false);
    expect(isTrashableSessionPath(`/Users/me/app/${id}.jsonl`, config)).toBe(false);
    expect(isTrashableSessionPath(`${config}/projects/../../${id}.jsonl`, config)).toBe(false);
    expect(isTrashableSessionPath(`${config}/projects/x/notes.jsonl`, config)).toBe(false);
    expect(isTrashableSessionPath(`relative/${id}.jsonl`, config)).toBe(false);
  });
});

describe('isTrashableRepoFile', () => {
  it('allows files inside a git checkout, never the checkout itself or .git', () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'trash-repo-')));
    try {
      mkdirSync(join(repo, '.git'));
      mkdirSync(join(repo, 'src'));
      writeFileSync(join(repo, 'src', 'new.ts'), '');
      writeFileSync(join(repo, '.git', 'config'), '');
      expect(isTrashableRepoFile(join(repo, 'src', 'new.ts'), repo)).toBe(true);
      expect(isTrashableRepoFile(join(repo, 'src'), repo)).toBe(false);
      expect(isTrashableRepoFile(repo, repo)).toBe(false);
      expect(isTrashableRepoFile(join(repo, '.git', 'config'), repo)).toBe(false);
      expect(isTrashableRepoFile(join(repo, 'src', '..', '..', 'x'), repo)).toBe(false);
      expect(isTrashableRepoFile(join(repo, 'missing.ts'), repo)).toBe(false);
      rmSync(join(repo, '.git'), { recursive: true });
      expect(isTrashableRepoFile(join(repo, 'src', 'new.ts'), repo)).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
