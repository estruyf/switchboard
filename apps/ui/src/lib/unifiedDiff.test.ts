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
});
