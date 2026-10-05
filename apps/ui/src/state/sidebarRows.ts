import type { SessionRowData } from './sessionsStore.ts';

/** What the status icon on a row shows, most urgent first. */
export type RowStatus = 'needs-you' | 'running' | 'error' | 'unread' | 'idle' | null;

export function rowStatus(row: SessionRowData): RowStatus {
  if (row.live?.status === 'needs-you') return 'needs-you';
  if (row.live?.status === 'running') return 'running';
  if (row.error) return 'error';
  if (row.unread) return 'unread';
  if (row.live?.status === 'idle') return 'idle';
  return null;
}

/** Sessions with activity in this window stay in the main list. */
export const RECENT_MS = 48 * 60 * 60 * 1000;

/**
 * Main list or "Settled"? Anything that wants attention (working, waiting,
 * failed, unread, open) or is pinned stays up. Settling by hand hides a
 * session until it has new activity; otherwise sessions settle after 48 h.
 */
export function isActive(row: SessionRowData, now: number): boolean {
  if (row.live?.status === 'running' || row.live?.status === 'needs-you' || row.error) return true;
  if (row.pinned) return true;
  const settledByHand = row.settledAt !== null && row.settledAt >= row.updatedAt;
  if (settledByHand) return false;
  return row.live !== null || row.unread || now - row.updatedAt < RECENT_MS;
}

export interface SessionListOptions {
  search: string;
  /** Only this project folder; null = all. */
  project: string | null;
  now: number;
}

const matches = (row: SessionRowData, needle: string) =>
  row.title.toLowerCase().includes(needle) ||
  row.projectRoot.toLowerCase().includes(needle) ||
  (row.branch?.toLowerCase().includes(needle) ?? false);

/** Splits sessions into the main list (pinned first, then newest) and the settled list (newest first). */
export function buildSessionList(rows: readonly SessionRowData[], options: SessionListOptions): { active: SessionRowData[]; settled: SessionRowData[] } {
  const needle = options.search.trim().toLowerCase();
  const active: SessionRowData[] = [];
  const settled: SessionRowData[] = [];
  for (const row of rows) {
    if (options.project && row.projectRoot !== options.project) continue;
    if (needle && !matches(row, needle)) continue;
    (isActive(row, options.now) ? active : settled).push(row);
  }
  active.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  settled.sort((a, b) => b.updatedAt - a.updatedAt);
  return { active, settled };
}
