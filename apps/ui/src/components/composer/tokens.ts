/** Finds the `/command` (only at the very start) or `@path` token the caret is in. */
export function tokenAtCaret(text: string, caret: number): { kind: 'slash' | 'file'; start: number; query: string } | null {
  const before = text.slice(0, caret);
  const slash = /^\/([\w:.-]*)$/.exec(before);
  if (slash) return { kind: 'slash', start: 0, query: slash[1]! };
  const at = /(^|\s)@([^\s@]*)$/.exec(before);
  if (at) return { kind: 'file', start: caret - at[2]!.length - 1, query: at[2]! };
  return null;
}

