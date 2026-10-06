import type { SessionScope, StartupView } from '@switchboard/protocol/bridge';
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

/** Whether the sidebar (and the palette) list a session under the chosen scope. */
export const inScope = (row: SessionRowData, scope: SessionScope) => scope === 'all' || row.inApp;

/**
 * The session a new window opens with, or null for New session: the one open last time, but only
 * while the sidebar lists it (a session from another app stays hidden while those are).
 */
export function startupSession(rows: SessionRowData[], lastId: unknown, startupView: StartupView, scope: SessionScope): string | null {
  if (startupView !== 'last' || typeof lastId !== 'string') return null;
  const last = rows.find((row) => row.id === lastId);
  return last && inScope(last, scope) ? last.id : null;
}

/**
 * Main list or "Settled"? Anything that wants attention (working, waiting,
 * failed, unread, open in Switchboard) or is pinned stays up. Settling by hand hides a
 * session until it has new activity; otherwise sessions settle after 48 h.
 */
export function isActive(row: SessionRowData, now: number): boolean {
  // Anything that needs you always shows.
  if (row.live?.status === 'needs-you' || row.error) return true;
  if (row.pinned) return true;
  // Settled by hand: hidden until there's something new to see. A session that's still
  // working stays settled (its constant updates aren't news); it comes back once it finishes.
  if (row.settledAt !== null && (row.settledAt >= row.updatedAt || row.live?.status === 'running')) return false;
  if (row.live?.status === 'running') return true;
  // Open in Switchboard counts; a process idling elsewhere doesn't (Claude desktop reopens
  // many old sessions at launch, and they shouldn't all come back).
  return row.live?.origin === 'app' || row.unread || now - row.updatedAt < RECENT_MS;
}

export interface SessionListOptions {
  search: string;
  /** Only this project folder; null = all. */
  project: string | null;
  now: number;
  /** Default: every session. */
  scope?: SessionScope;
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
    if (options.scope && !inScope(row, options.scope)) continue;
    if (options.project && row.projectRoot !== options.project) continue;
    if (needle && !matches(row, needle)) continue;
    (isActive(row, options.now) ? active : settled).push(row);
  }
  active.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  settled.sort((a, b) => b.updatedAt - a.updatedAt);
  return { active, settled };
}
