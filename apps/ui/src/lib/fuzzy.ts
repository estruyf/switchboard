/**
 * Matches `query` against `text` as a subsequence (case-insensitive): null when it doesn't, otherwise
 * a score (higher when letters land at word starts or run together) and the positions of the matched
 * letters, so a list can highlight them.
 */
export function fuzzyMatch(query: string, text: string): { score: number; indices: number[] } | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -2;
  const indices: number[] = [];
  for (const ch of q) {
    const at = t.indexOf(ch, from);
    if (at === -1) return null;
    const wordStart = at === 0 || /[\s\-_/.:·]/.test(t[at - 1]!);
    score += 1 + (wordStart ? 3 : 0) + (at === previous + 1 ? 2 : 0);
    indices.push(at);
    previous = at;
    from = at + 1;
  }
  // Prefer shorter texts and matches that start early.
  return { score: score - t.length * 0.01 - t.indexOf(q[0]!) * 0.05, indices };
}

/**
 * Scores how well `query` matches `text` as a subsequence (case-insensitive):
 * null when it doesn't, higher when letters land at word starts or run together.
 * "tt" finds "Toggle terminal"; "nses" finds "New session".
 */
export function fuzzyScore(query: string, text: string): number | null {
  return fuzzyMatch(query, text)?.score ?? null;
}
