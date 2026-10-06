import type { SessionRowData } from '../../state/sessionsStore.ts';

/**
 * The sessions Home shows: those waiting for you (longest wait first, as the most overdue) and those
 * Claude is working on (most recent first). Pass the rows the sidebar lists.
 */
export function homeSessions(rows: readonly SessionRowData[]): { needs: SessionRowData[]; working: SessionRowData[] } {
  const needs = rows.filter((row) => row.live?.status === 'needs-you').sort((a, b) => a.updatedAt - b.updatedAt);
  const working = rows.filter((row) => row.live?.status === 'running').sort((a, b) => b.updatedAt - a.updatedAt);
  return { needs, working };
}

const sessions = (n: number) => `${n} ${n === 1 ? 'session' : 'sessions'}`;

/** "2 sessions need you, 1 is working." in plain words, or what to do when nothing is going on. */
export function homeSummary(needs: number, working: number): string {
  const verb = (n: number, one: string, many: string) => (n === 1 ? one : many);
  if (needs && working) return `${sessions(needs)} ${verb(needs, 'needs', 'need')} you, ${working} ${verb(working, 'is', 'are')} working.`;
  if (needs) return `${sessions(needs)} ${verb(needs, 'needs', 'need')} you.`;
  if (working) return `${sessions(working)} ${verb(working, 'is', 'are')} working. Nothing needs you.`;
  return 'Nothing needs you. Start a session, or pick one in the sidebar.';
}

/** A project tile's detail line: the checked-out branch and how many sessions are open there. */
export function projectMeta(branch: string | null | undefined, open: number): string {
  const parts = [branch, open ? `${open} open` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No sessions open';
}
