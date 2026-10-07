import { fuzzyMatch } from '../../lib/fuzzy.ts';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { rowStatus } from '../../state/sidebarRows.ts';

/** What needs attention first: needs you, then working, then finished and unread, then the rest. */
export function sessionUrgency(row: SessionRowData): number {
  const status = rowStatus(row);
  return status === 'needs-you' ? 0 : status === 'running' ? 1 : status === 'unread' ? 2 : 3;
}

/** Sessions for ⌘P: by urgency, then the most recent first. */
export function orderSessions(rows: readonly SessionRowData[]): SessionRowData[] {
  return [...rows].sort((a, b) => sessionUrgency(a) - sessionUrgency(b) || b.updatedAt - a.updatedAt);
}

export interface Matched<T> {
  item: T;
  /** Letters of the title that matched, to highlight. */
  indices: number[];
}

/**
 * Sessions matching what is typed, by title (or project name, a little lower), the urgent ones first
 * among equals. With nothing typed: the first `limit` in `orderSessions` order.
 */
export function matchSessions(rows: readonly SessionRowData[], query: string, projectName: (root: string) => string, limit: number): Array<Matched<SessionRowData>> {
  if (!query.trim()) return orderSessions(rows).slice(0, limit).map((item) => ({ item, indices: [] }));
  return rows
    .flatMap((row) => {
      const byTitle = fuzzyMatch(query, row.title);
      const byProject = fuzzyMatch(query, projectName(row.projectRoot));
      const projectScore = byProject ? byProject.score - 2 : -Infinity;
      const score = Math.max(byTitle?.score ?? -Infinity, projectScore);
      return score === -Infinity ? [] : [{ item: row, score, indices: byTitle && byTitle.score >= projectScore ? byTitle.indices : [] }];
    })
    .sort((a, b) => b.score - a.score || sessionUrgency(a.item) - sessionUrgency(b.item) || b.item.updatedAt - a.item.updatedAt)
    .slice(0, limit)
    .map(({ item, indices }) => ({ item, indices }));
}

/** Project folders matching what is typed, by name (or path, a little lower); all of them, in the given order, with nothing typed. */
export function matchProjects(roots: readonly string[], query: string, nameOf: (root: string) => string): Array<Matched<string>> {
  if (!query.trim()) return roots.map((item) => ({ item, indices: [] }));
  return roots
    .flatMap((root) => {
      const byName = fuzzyMatch(query, nameOf(root));
      const byPath = fuzzyMatch(query, root);
      const pathScore = byPath ? byPath.score - 2 : -Infinity;
      const score = Math.max(byName?.score ?? -Infinity, pathScore);
      return score === -Infinity ? [] : [{ item: root, score, indices: byName && byName.score >= pathScore ? byName.indices : [] }];
    })
    .sort((a, b) => b.score - a.score)
    .map(({ item, indices }) => ({ item, indices }));
}
