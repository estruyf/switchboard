import { describe, expect, it } from 'vitest';
import { describeItems, problemsItem, resourceItems, selectedLines, selectionItem, terminalItem, type EditorSelection } from './payload.ts';

const selection = (over: Partial<EditorSelection> = {}): EditorSelection => ({
  path: '/repo/src/auth.ts',
  name: 'auth.ts',
  startLine: 11,
  endLine: 39,
  endCharacter: 12,
  isEmpty: false,
  dirty: false,
  text: 'const token = …',
  languageId: 'typescript',
  ...over,
});

describe('selections', () => {
  it('sends a saved file as a reference to its lines, counted from 1', () => {
    expect(selectionItem(selection())).toEqual({ kind: 'item', item: { kind: 'file', path: '/repo/src/auth.ts', range: { start: 12, end: 40 } } });
  });

  it('leaves out the last line when the selection ends at its start', () => {
    expect(selectedLines({ startLine: 4, endLine: 9, endCharacter: 0 })).toEqual({ start: 5, end: 9 });
    expect(selectedLines({ startLine: 4, endLine: 4, endCharacter: 0 })).toEqual({ start: 5, end: 5 });
  });

  it('sends the whole file when nothing is selected', () => {
    expect(selectionItem(selection({ isEmpty: true }))).toEqual({ kind: 'item', item: { kind: 'file', path: '/repo/src/auth.ts' } });
  });

  it('sends unsaved changes as text, since Claude would read the old file', () => {
    expect(selectionItem(selection({ dirty: true, languageId: 'typescriptreact' }))).toEqual({
      kind: 'item',
      item: { kind: 'text', source: 'selection', label: 'Lines 12-40 of auth.ts (unsaved)', text: 'const token = …', path: '/repo/src/auth.ts', range: { start: 12, end: 40 }, language: 'tsx' },
    });
  });

  it('sends an untitled editor as text', () => {
    expect(selectionItem(selection({ path: null, name: 'Untitled-1', isEmpty: true, dirty: true, text: 'notes', languageId: 'plaintext' }))).toEqual({
      kind: 'item',
      item: { kind: 'text', source: 'selection', label: 'Untitled-1', text: 'notes', language: '' },
    });
  });

  it('holds back the text of a file kept from Claude, and sends only the reference', () => {
    expect(selectionItem(selection({ dirty: true }), '.env is ignored by git')).toEqual({
      kind: 'withheld',
      item: { kind: 'file', path: '/repo/src/auth.ts', range: { start: 12, end: 40 } },
      reason: '.env is ignored by git',
    });
  });
});

describe('resources', () => {
  it('sends an Explorer multi-select once each, folders as folders', () => {
    expect(
      resourceItems([
        { path: '/repo/src', directory: true },
        { path: '/repo/README.md', directory: false },
        { path: '/repo/README.md', directory: false },
        { path: 'relative.txt', directory: false },
      ]),
    ).toEqual([
      { kind: 'file', path: '/repo/src', directory: true },
      { kind: 'file', path: '/repo/README.md', directory: false },
    ]);
  });
});

describe('problems', () => {
  const relative = (path: string) => path.replace('/repo/', '');

  it('lists errors first, one per line, with where and what', () => {
    const item = problemsItem(
      [
        { path: '/repo/src/b.ts', line: 0, character: 0, severity: 'warning', message: 'Unused import', source: 'eslint', code: 'no-unused-vars' },
        { path: '/repo/src/a.ts', line: 11, character: 4, severity: 'error', message: "Argument of type 'string'\n  is not assignable", source: 'ts', code: 2345 },
      ],
      relative,
      null,
    );
    expect(item).toEqual({
      kind: 'text',
      source: 'problems',
      label: 'Problems in the workspace (1 error, 1 warning)',
      text: "src/a.ts:12:5 error ts(2345): Argument of type 'string' is not assignable\nsrc/b.ts:1:1 warning eslint(no-unused-vars): Unused import",
    });
  });

  it('names the file, and has nothing to send without problems', () => {
    expect(problemsItem([{ path: '/repo/a.ts', line: 0, character: 0, severity: 'error', message: 'x' }], relative, '/repo/a.ts')).toMatchObject({ label: 'Problems in a.ts (1 error)', path: '/repo/a.ts' });
    expect(problemsItem([], relative, '/repo/a.ts')).toBeNull();
  });
});

describe('terminal output', () => {
  it('drops the padding and blank lines around it', () => {
    expect(terminalItem('\n$ npm test   \nFAIL  src/a.test.ts  \n\n', 'zsh')).toEqual({ kind: 'text', source: 'terminal', label: 'Terminal: zsh', text: '$ npm test\nFAIL  src/a.test.ts' });
    expect(terminalItem('   \n', 'zsh')).toBeNull();
  });
});

describe('describeItems', () => {
  it('says what was added', () => {
    expect(describeItems([{ kind: 'file', path: '/repo/src/auth.ts', range: { start: 12, end: 40 } }])).toBe('auth.ts lines 12-40');
    expect(describeItems([{ kind: 'file', path: '/repo/src', directory: true }])).toBe('src/');
    expect(describeItems([{ kind: 'file', path: '/a' }, { kind: 'file', path: '/b' }, { kind: 'text', source: 'terminal', label: 'T', text: 'x' }])).toBe('2 files and 1 text');
  });
});
