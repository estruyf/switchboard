import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './unifiedDiff.ts';

describe('parseUnifiedDiff', () => {
  it('numbers lines from the hunk headers and drops file headers', () => {
    const diff = ['diff --git a/a.txt b/a.txt', 'index 1..2 100644', '--- a/a.txt', '+++ b/a.txt', '@@ -1,2 +1,2 @@ function x', ' one', '-two', '+TWO', '\\ No newline at end of file', ''].join('\n');
    expect(parseUnifiedDiff(diff)).toEqual([
      { kind: 'hunk', text: 'function x' },
      { kind: 'same', text: 'one', oldLine: 1, newLine: 1 },
      { kind: 'del', text: 'two', oldLine: 2, newLine: null },
      { kind: 'add', text: 'TWO', oldLine: null, newLine: 2 },
      { kind: 'note', text: 'No newline at end of file' },
    ]);
  });

  it('notes binary files', () => {
    expect(parseUnifiedDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n')).toEqual([{ kind: 'note', text: 'Binary file' }]);
  });

  it('reads an empty line inside a hunk as a blank context line', () => {
    // git with diff.suppressBlankEmpty writes a blank context line as '' instead of ' '.
    const diff = ['@@ -1,4 +1,4 @@', ' one', '', '-three', '+THREE', ' four', ''].join('\n');
    expect(parseUnifiedDiff(diff)).toEqual([
      { kind: 'hunk', text: '' },
      { kind: 'same', text: 'one', oldLine: 1, newLine: 1 },
      { kind: 'same', text: '', oldLine: 2, newLine: 2 },
      { kind: 'del', text: 'three', oldLine: 3, newLine: null },
      { kind: 'add', text: 'THREE', oldLine: null, newLine: 3 },
      { kind: 'same', text: 'four', oldLine: 4, newLine: 4 },
    ]);
  });

  it('takes a hunk header without counts as one line', () => {
    expect(parseUnifiedDiff('@@ -3 +3 @@\n-a\n+b\n')).toEqual([
      { kind: 'hunk', text: '' },
      { kind: 'del', text: 'a', oldLine: 3, newLine: null },
      { kind: 'add', text: 'b', oldLine: null, newLine: 3 },
    ]);
  });
});
