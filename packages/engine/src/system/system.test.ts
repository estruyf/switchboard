import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeCandidates, findClaude, parseClaudeVersion } from './claudeBinary.ts';
import { parseEnvOutput } from './shellEnv.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('parseEnvOutput', () => {
  it('reads NUL-separated entries between markers and ignores rc-file noise', () => {
    const out = 'Welcome to zsh!\n__SWITCHBOARD_ENV__PATH=/opt/homebrew/bin:/usr/bin\0MULTI=line one\nline two\0EMPTY=\0__SWITCHBOARD_ENV__';
    expect(parseEnvOutput(out)).toEqual({ PATH: '/opt/homebrew/bin:/usr/bin', MULTI: 'line one\nline two', EMPTY: '' });
  });

  it('returns null when markers are missing', () => {
    expect(parseEnvOutput('PATH=/usr/bin')).toBeNull();
  });
});

describe('claude binary', () => {
  it('parses the version line', () => {
    expect(parseClaudeVersion('2.1.285 (Claude Code)\n')).toBe('2.1.285');
    expect(parseClaudeVersion('garbage')).toBeNull();
  });

  it('checks PATH before the well-known locations, without duplicates', () => {
    const candidates = claudeCandidates({ PATH: '/x/bin:/opt/homebrew/bin' }, '/home/me');
    expect(candidates[0]).toBe('/x/bin/claude');
    expect(candidates.filter((c) => c === '/opt/homebrew/bin/claude')).toHaveLength(1);
    expect(candidates).toContain('/home/me/.claude/local/claude');
  });

  it('finds an executable on PATH and reads its version', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'switchboard-bin-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'bin'));
    const fake = join(dir, 'bin', 'claude');
    writeFileSync(fake, '#!/bin/sh\necho "9.8.7 (Claude Code)"\n');
    chmodSync(fake, 0o755);
    await expect(findClaude({ PATH: join(dir, 'bin') })).resolves.toEqual({ path: fake, version: '9.8.7' });
  });
});
