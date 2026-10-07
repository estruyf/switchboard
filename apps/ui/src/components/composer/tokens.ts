/** Finds the `/command` or `@path` token the caret is in; both start the text or follow whitespace. */
export function tokenAtCaret(text: string, caret: number): { kind: 'slash' | 'file'; start: number; query: string } | null {
  const before = text.slice(0, caret);
  const slash = /(^|\s)\/([\w:.-]*)$/.exec(before);
  if (slash) return { kind: 'slash', start: caret - slash[2]!.length - 1, query: slash[2]! };
  const at = /(^|\s)@([^\s@]*)$/.exec(before);
  if (at) return { kind: 'file', start: caret - at[2]!.length - 1, query: at[2]! };
  return null;
}
