import type { CompanionSession, CompanionStatus, LiveSession, SessionHostInfo, SessionSummary } from '@switchboard/protocol';

/** What the engine knows about sessions: transcripts, running processes, and the ones this app runs. */
export interface SessionSources {
  summaries: readonly SessionSummary[];
  live: readonly LiveSession[];
  hosts: readonly SessionHostInfo[];
}

const activeHost = (host: SessionHostInfo | undefined): host is SessionHostInfo => !!host && host.state !== 'closed' && host.state !== 'error';

/** A running host's state in the registry's terms, as the sidebar merges them (`hostAsLive` in the UI). */
function hostLive(host: SessionHostInfo): Pick<LiveSession, 'status' | 'background'> {
  const status = host.state === 'needs-you' ? 'needs-you' : host.state === 'idle' ? 'idle' : 'running';
  return { status, background: host.backgroundTasks.map((t) => t.description) };
}

/** How a session is doing, in the sidebar's order of urgency (`rowStatus` in the UI). */
export function companionStatus(summary: SessionSummary | null, live: LiveSession | null, host: SessionHostInfo | undefined): CompanionStatus {
  // Sessions running in this app report their own state; it is more precise than the registry.
  const state = activeHost(host) ? hostLive(host) : live;
  if (state?.status === 'needs-you') return 'needs-you';
  if (state?.status === 'running') return 'working';
  if (host?.state === 'error') return 'error';
  if (summary?.unread) return 'unread';
  if (state?.status === 'idle') return state.background?.length ? 'background' : 'idle';
  return 'stopped';
}

const realBranch = (branch: string | null) => (branch && branch !== 'HEAD' ? branch : null);

/** Archived by hand and nothing new since, unless it runs. */
const archived = (summary: SessionSummary, status: CompanionStatus) =>
  summary.archivedAt !== null && summary.archivedAt >= summary.updatedAt && (status === 'stopped' || status === 'idle');

/** Every session worth offering: indexed ones (not archived), and running ones that haven't written a transcript yet. */
export function companionSessions(sources: SessionSources): CompanionSession[] {
  const live = new Map(sources.live.map((l) => [l.sessionId, l]));
  const hosts = new Map(sources.hosts.map((h) => [h.sessionId, h]));
  const out: CompanionSession[] = [];
  const seen = new Set<string>();
  for (const summary of sources.summaries) {
    seen.add(summary.id);
    const l = live.get(summary.id) ?? null;
    const host = hosts.get(summary.id);
    const status = companionStatus(summary, l, host);
    if (archived(summary, status)) continue;
    out.push({
      id: summary.id,
      title: summary.customTitle ?? (l?.name || summary.title),
      cwd: (activeHost(host) ? host.cwd : null) ?? summary.cwd,
      projectRoot: summary.projectRoot,
      branch: summary.worktree?.branch ?? realBranch(summary.gitBranch),
      status,
      updatedAt: Math.max(summary.updatedAt, l && l.status !== 'idle' ? (l.updatedAt ?? 0) : 0),
      inApp: summary.inApp || l?.origin === 'app',
    });
  }
  const pending = [...sources.hosts.filter(activeHost).map((h) => ({ id: h.sessionId, cwd: h.cwd, origin: 'app' as const, name: null, at: h.startedAt })), ...sources.live.map((l) => ({ id: l.sessionId, cwd: l.cwd, origin: l.origin, name: l.name, at: l.updatedAt ?? l.startedAt ?? 0 }))];
  for (const p of pending) {
    // SDK processes without a conversation are helpers (command lists, usage), not sessions.
    if (seen.has(p.id) || p.origin === 'sdk') continue;
    seen.add(p.id);
    const host = hosts.get(p.id);
    const l = live.get(p.id) ?? null;
    out.push({
      id: p.id,
      title: p.name ?? 'New session',
      cwd: p.cwd,
      projectRoot: l?.projectRoot ?? p.cwd?.replace(/\/\.claude\/worktrees\/[^/]+.*$/, '') ?? 'Unknown folder',
      branch: null,
      status: companionStatus(null, l, host),
      updatedAt: p.at,
      inApp: p.origin === 'app',
    });
  }
  return out;
}

/** `path` is `folder` or inside it. */
export const isWithin = (path: string, folder: string) => {
  const root = folder.replace(/\/+$/, '') || '/';
  return path === root || path.startsWith(root === '/' ? '/' : `${root}/`);
};

/**
 * Whether a session belongs to one of the workspace folders: it works in one of them (or below it), or one of them
 * is inside the folder it works in. No folders means every session.
 */
export function inFolders(session: Pick<CompanionSession, 'cwd' | 'projectRoot'>, folders: readonly string[]): boolean {
  if (folders.length === 0) return true;
  const where = session.cwd ?? session.projectRoot;
  return folders.some((folder) => isWithin(where, folder) || isWithin(folder, where));
}

const URGENCY: Record<CompanionStatus, number> = { 'needs-you': 0, working: 1, error: 2, unread: 3, background: 4, idle: 5, stopped: 6 };

/** The sessions for some folders: what needs you first, then what is working, then the most recent. */
export function sessionsFor(all: readonly CompanionSession[], folders: readonly string[], limit = 50): CompanionSession[] {
  return all
    .filter((s) => inFolders(s, folders))
    .sort((a, b) => URGENCY[a.status] - URGENCY[b.status] || b.updatedAt - a.updatedAt)
    .slice(0, limit);
}
