export type UnifiedRow =
  | { kind: 'hunk'; text: string }
  | { kind: 'add' | 'del' | 'same'; text: string; oldLine: number | null; newLine: number | null }
  | { kind: 'note'; text: string };

/**
 * Rows for a git unified diff: hunk headers, then each line with its old and new
 * line numbers. File headers (diff --git, index, ---/+++) are dropped; binary files
 * and "\ No newline" markers become notes.
 */
export function parseUnifiedDiff(diff: string): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: 'hunk', text: hunk[3]!.trim() });
      continue;
    }
    if (!inHunk) {
      if (/^Binary files /.test(line)) rows.push({ kind: 'note', text: 'Binary file' });
      continue;
    }
    if (line.startsWith('diff --git')) {
      inHunk = false;
      continue;
    }
    if (line.startsWith('+')) rows.push({ kind: 'add', text: line.slice(1), oldLine: null, newLine: newLine++ });
    else if (line.startsWith('-')) rows.push({ kind: 'del', text: line.slice(1), oldLine: oldLine++, newLine: null });
    else if (line.startsWith(' ')) rows.push({ kind: 'same', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
    else if (line.startsWith('\\')) rows.push({ kind: 'note', text: line.slice(2) });
  }
  return rows;
}
