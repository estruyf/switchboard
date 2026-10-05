import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveRegistry, normaliseStatus, parseRegistryEntry } from './liveRegistry.ts';
import { originFromEntrypoint, readEntrypoint } from './origin.ts';
import { createProjectResolver } from './projectResolver.ts';
import { clipJson, LIMITS, normaliseMessage } from './transcript.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-claude-')));
  dirs.push(dir);
  return dir;
};

describe('normaliseMessage', () => {
  it('turns a plain user prompt into a text block', () => {
    const m = normaliseMessage({ type: 'user', uuid: 'u1', parent_tool_use_id: null, timestamp: '2026-10-05T10:00:00.000Z', message: { role: 'user', content: 'Fix the bug' } });
    expect(m).toEqual({ uuid: 'u1', role: 'user', timestamp: Date.parse('2026-10-05T10:00:00.000Z'), parentToolUseId: null, model: null, blocks: [{ type: 'text', text: 'Fix the bug' }] });
  });

  it('keeps assistant text, thinking and tool calls, and clips long tool input', () => {
    const big = 'x'.repeat(LIMITS.toolInputString + 10);
    const m = normaliseMessage({
      type: 'assistant',
      uuid: 'a1',
      parent_tool_use_id: null,
      message: {
        model: 'claude-opus-5-5',
        content: [
          { type: 'thinking', thinking: 'Let me look' },
          { type: 'text', text: 'Writing the file.' },
          { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/a.ts', content: big } },
          { type: 'some_future_block' },
        ],
      },
    });
    expect(m.model).toBe('claude-opus-5-5');
    expect(m.blocks.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use', 'unknown']);
    const tool = m.blocks[2];
    expect(tool).toMatchObject({ type: 'tool_use', id: 't1', name: 'Write', truncated: true });
    expect(tool?.type === 'tool_use' && (tool.input as { content: string }).content.length).toBe(LIMITS.toolInputString);
    expect(m.blocks[3]).toEqual({ type: 'unknown', kind: 'some_future_block' });
  });

  it('flattens tool results and clips long output', () => {
    const m = normaliseMessage({
      type: 'user',
      uuid: 'u2',
      parent_tool_use_id: 'parent',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'line 1' }, { type: 'image' }, { type: 'text', text: 'y'.repeat(LIMITS.toolResult) }] },
        ],
      },
    });
    expect(m.parentToolUseId).toBe('parent');
    expect(m.blocks[0]).toMatchObject({ type: 'tool_result', toolUseId: 't1', isError: true, truncated: true });
    expect(m.blocks[0]?.type === 'tool_result' && m.blocks[0].text.startsWith('line 1\n[image]\n')).toBe(true);
  });

  it('copes with unexpected shapes instead of throwing', () => {
    const m = normaliseMessage({ type: 'system', uuid: 's1', parent_tool_use_id: null, timestamp: 'not a date', message: { subtype: 'compact_boundary' } });
    expect(m.timestamp).toBeNull();
    expect(m.blocks).toEqual([{ type: 'unknown', kind: 'compact_boundary' }]);
  });
});

describe('clipJson', () => {
  it('drops undefined, non-finite numbers and over-deep nesting', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 30; i++) deep = [deep];
    const { value, truncated } = clipJson({ a: undefined, b: Infinity, c: deep }, 10);
    expect(value).not.toHaveProperty('a');
    expect((value as { b: unknown }).b).toBeNull();
    expect(truncated).toBe(true);
  });
});

describe('origin', () => {
  it('maps entrypoints to origins', () => {
    expect(originFromEntrypoint('cli')).toBe('cli');
    expect(originFromEntrypoint('claude-desktop')).toBe('desktop');
    expect(originFromEntrypoint('claude-vscode')).toBe('ide');
    expect(originFromEntrypoint('sdk-ts')).toBe('sdk');
    expect(originFromEntrypoint('switchboard')).toBe('app');
    expect(originFromEntrypoint(null)).toBe('unknown');
  });

  it('reads the entrypoint from the head of a transcript', () => {
    const file = join(tempDir(), 's.jsonl');
    writeFileSync(file, '{"type":"queue-operation"}\n{"type":"user","entrypoint":"cli","cwd":"/x"}\n');
    expect(readEntrypoint(file)).toBe('cli');
    expect(readEntrypoint(join(tempDir(), 'missing.jsonl'))).toBeNull();
  });
});

describe('project resolver', () => {
  it('groups a nested folder under its git root and reads the branch', () => {
    const repo = tempDir();
    mkdirSync(join(repo, '.git'));
    writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');
    mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
    const resolver = createProjectResolver('/nonexistent-home');
    const location = resolver.resolve(join(repo, 'src', 'deep'));
    expect(location).toEqual({ root: repo, gitDir: join(repo, '.git'), worktree: null });
    expect(resolver.branch(location)).toBe('feature/x');
  });

  it('folds a linked worktree into its main repository', () => {
    const repo = tempDir();
    const wtGitDir = join(repo, '.git', 'worktrees', 'my-wt');
    mkdirSync(wtGitDir, { recursive: true });
    writeFileSync(join(wtGitDir, 'HEAD'), 'ref: refs/heads/worktree-my-wt\n');
    const wt = join(repo, '.claude', 'worktrees', 'my-wt');
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, '.git'), `gitdir: ${wtGitDir}\n`);
    const resolver = createProjectResolver('/nonexistent-home');
    const location = resolver.resolve(wt);
    expect(location.root).toBe(repo);
    expect(location.worktree).toEqual({ name: 'my-wt', path: wt });
    expect(resolver.branch(location)).toBe('worktree-my-wt');
  });

  it('still recognises a deleted Claude worktree by its path', () => {
    const location = createProjectResolver('/nonexistent-home').resolve('/gone/repo/.claude/worktrees/old-wt/src');
    expect(location).toEqual({ root: '/gone/repo', gitDir: null, worktree: { name: 'old-wt', path: '/gone/repo/.claude/worktrees/old-wt' } });
  });

  it('does not treat a git repo in the home folder as the root of everything below it', () => {
    const home = tempDir();
    mkdirSync(join(home, '.git'));
    mkdirSync(join(home, 'notes'));
    const resolver = createProjectResolver(home);
    expect(resolver.resolve(join(home, 'notes'))).toEqual({ root: join(home, 'notes'), gitDir: null, worktree: null });
    expect(resolver.resolve(home).root).toBe(home);
  });
});

describe('live registry', () => {
  it('normalises statuses', () => {
    expect(normaliseStatus('busy')).toBe('running');
    expect(normaliseStatus('idle')).toBe('idle');
    expect(normaliseStatus('waiting')).toBe('needs-you');
    expect(normaliseStatus('requires_action')).toBe('needs-you');
    expect(normaliseStatus('something-new')).toBe('running');
  });

  it('parses an entry and rejects junk', () => {
    const entry = parseRegistryEntry(
      { pid: 42, sessionId: 's1', cwd: '/repo/app', status: 'busy', name: 'Fix tests', entrypoint: 'cli', startedAt: 1, statusUpdatedAt: 2 },
      () => '/repo',
    );
    expect(entry).toEqual({ sessionId: 's1', pid: 42, cwd: '/repo/app', projectRoot: '/repo', status: 'running', rawStatus: 'busy', name: 'Fix tests', origin: 'cli', startedAt: 1, updatedAt: 2 });
    expect(parseRegistryEntry({ sessionId: 's1' }, () => null)).toBeNull();
    expect(parseRegistryEntry('nope', () => null)).toBeNull();
  });

  it('lists only live processes and reports changes once', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '1.json'), JSON.stringify({ pid: 1, sessionId: 'alive', status: 'idle' }));
    writeFileSync(join(dir, '2.json'), JSON.stringify({ pid: 2, sessionId: 'dead', status: 'busy' }));
    writeFileSync(join(dir, '3.json'), '{ half written');
    const changes: string[][] = [];
    const registry = new LiveRegistry({ dir, resolveRoot: () => null, isAlive: (pid) => pid === 1, onChange: (live) => changes.push(live.map((l) => l.sessionId)) });
    registry.scan();
    registry.scan();
    expect(changes).toEqual([['alive']]);
    writeFileSync(join(dir, '1.json'), JSON.stringify({ pid: 1, sessionId: 'alive', status: 'busy' }));
    registry.scan();
    expect(changes).toHaveLength(2);
    expect(registry.list()[0]?.status).toBe('running');
  });
});
