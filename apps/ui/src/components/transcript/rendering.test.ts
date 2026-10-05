import { describe, expect, it } from 'vitest';
import { grammarFor, languageFromPath } from '../../lib/highlight.ts';
import { formatShortcut, shortcutFromEvent } from '../../lib/shortcuts.ts';
import { computeDiff } from './DiffView.tsx';
import { parseTodos } from './TodoList.tsx';
import { editHunks } from './toolSummary.ts';

describe('computeDiff', () => {
  it('marks changed lines and folds distant unchanged ones', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
    const after = ['a', 'b', 'c', 'd', 'e', 'f', 'G', 'h'].join('\n');
    expect(computeDiff(before, after, 1)).toEqual([
      { kind: 'gap', count: 5 },
      { kind: 'same', text: 'f' },
      { kind: 'del', text: 'g' },
      { kind: 'add', text: 'G' },
      { kind: 'same', text: 'h' },
    ]);
  });
  it('shows a new file as additions', () => {
    expect(computeDiff('', 'x\ny\n')).toEqual([
      { kind: 'add', text: 'x' },
      { kind: 'add', text: 'y' },
    ]);
  });
});

describe('editHunks', () => {
  it('reads Edit, MultiEdit and Write inputs', () => {
    expect(editHunks({ name: 'Edit', input: { old_string: 'a', new_string: 'b' } })).toEqual([{ before: 'a', after: 'b' }]);
    expect(editHunks({ name: 'MultiEdit', input: { edits: [{ old_string: '1', new_string: '2' }, { old_string: '3', new_string: '4' }] } })).toHaveLength(2);
    expect(editHunks({ name: 'Write', input: { content: 'new file' } })).toEqual([{ before: '', after: 'new file' }]);
    expect(editHunks({ name: 'Bash', input: { command: 'ls' } })).toBeNull();
  });
});

describe('parseTodos', () => {
  it('keeps valid items and normalises unknown statuses', () => {
    expect(parseTodos({ todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'weird', activeForm: 'Doing B' }, { nope: 1 }] })).toEqual([
      { content: 'A', status: 'completed' },
      { content: 'B', status: 'pending', activeForm: 'Doing B' },
    ]);
    expect(parseTodos(null)).toEqual([]);
  });
});

describe('highlighting languages', () => {
  it('maps fences and file names to grammars', () => {
    expect(grammarFor('ts')).toBe('typescript');
    expect(grammarFor('Bash')).toBe('shellscript');
    expect(grammarFor('brainfuck')).toBeNull();
    expect(languageFromPath('/repo/src/App.tsx')).toBe('tsx');
    expect(languageFromPath('/repo/Dockerfile')).toBe('docker');
  });
});

describe('action shortcuts', () => {
  const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}, code?: string) => ({
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: k,
    ...(code ? { code } : {}),
    ...mods,
  });
  it('reads and formats key combinations', () => {
    expect(shortcutFromEvent(key('P', { metaKey: true, shiftKey: true }))).toBe('cmd+shift+p');
    expect(shortcutFromEvent(key('π', { altKey: true }, 'KeyP'))).toBe('alt+p');
    expect(shortcutFromEvent(key('Shift', { shiftKey: true }))).toBeNull();
    expect(formatShortcut('cmd+shift+p')).toBe('⌘⇧P');
  });
});
