import { create } from 'zustand';
import type { LiveSession, SessionHostInfo, SessionsChanged, SessionsSnapshot, SessionSummary } from '@switchboard/protocol/client';
import { hostAsLive, isActiveHost } from './hostsStore.ts';

export type MainView = 'session' | 'new' | 'diagnostics' | 'settings';

interface SessionsState {
  sessions: Map<string, SessionSummary>;
  /** Live registry entries keyed by session id. */
  live: Map<string, LiveSession>;
  /** True once the engine finished its first scan of ~/.claude (until then the list is from cache). */
  complete: boolean;
  loaded: boolean;
  selectedId: string | null;
  view: MainView;
  filter: string;

  applySnapshot(snapshot: SessionsSnapshot): void;
  applyChanged(change: SessionsChanged): void;
  setLive(live: LiveSession[]): void;
  select(id: string | null): void;
  setView(view: MainView): void;
  setFilter(filter: string): void;
}

/** Claude Code records `HEAD` when there is no branch (e.g. before the first commit); that is not a name worth showing. */
export const realBranch = (branch: string | null) => (branch && branch !== 'HEAD' ? branch : null);

export const useSessions = create<SessionsState>()((set) => ({
  sessions: new Map(),
  live: new Map(),
  complete: false,
  loaded: false,
  selectedId: null,
  view: 'session',
  filter: '',

  applySnapshot: (snapshot) =>
    set({
      sessions: new Map(snapshot.sessions.map((s) => [s.id, s])),
      live: new Map(snapshot.live.map((l) => [l.sessionId, l])),
      complete: snapshot.complete,
      loaded: true,
    }),
  applyChanged: (change) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      for (const s of change.upserted) sessions.set(s.id, s);
      for (const id of change.removed) sessions.delete(id);
      return { sessions, complete: change.complete };
    }),
  setLive: (live) => set({ live: new Map(live.map((l) => [l.sessionId, l])) }),
  select: (id) => set({ selectedId: id, view: 'session' }),
  setView: (view) => set({ view }),
  setFilter: (filter) => set({ filter }),
}));

/** A session as the sidebar shows it: the summary (if indexed) merged with its live state. */
export interface SessionRowData {
  id: string;
  title: string;
  projectRoot: string;
  updatedAt: number;
  branch: string | null;
  isWorktree: boolean;
  live: LiveSession | null;
  summary: SessionSummary | null;
  pinned: boolean;
  settledAt: number | null;
  unread: boolean;
  /** The last run in this app failed. */
  error: boolean;
}

export function toRows(
  sessions: Map<string, SessionSummary>,
  live: Map<string, LiveSession>,
  hosts: Map<string, SessionHostInfo> = new Map(),
): SessionRowData[] {
  const rows: SessionRowData[] = [];
  // Sessions running in this app report their own state; it is more precise than the registry.
  const liveFor = (id: string) => {
    const host = hosts.get(id);
    return isActiveHost(host) ? hostAsLive(host) : (live.get(id) ?? null);
  };
  for (const s of sessions.values()) {
    const l = liveFor(s.id);
    rows.push({
      id: s.id,
      title: l?.name && !s.customTitle ? l.name : s.title,
      projectRoot: s.projectRoot,
      updatedAt: Math.max(s.updatedAt, l?.updatedAt ?? 0),
      branch: s.worktree?.branch ?? realBranch(s.gitBranch),
      isWorktree: s.worktree !== null,
      live: l,
      summary: s,
      pinned: s.pinned,
      settledAt: s.settledAt,
      unread: s.unread,
      error: hosts.get(s.id)?.state === 'error',
    });
  }
  // Running sessions that have not written a transcript yet still deserve a row.
  const seen = new Set(sessions.keys());
  const pending = [
    ...[...hosts.values()].filter(isActiveHost).flatMap((h) => hostAsLive(h) ?? []),
    ...live.values(),
  ];
  for (const l of pending) {
    if (seen.has(l.sessionId)) continue;
    seen.add(l.sessionId);
    rows.push({
      id: l.sessionId,
      title: l.name ?? 'New session',
      projectRoot: l.projectRoot ?? l.cwd ?? 'Unknown folder',
      updatedAt: l.updatedAt ?? l.startedAt ?? Date.now(),
      branch: null,
      isWorktree: false,
      live: l,
      summary: null,
      pinned: false,
      settledAt: null,
      unread: false,
      error: false,
    });
  }
  return rows;
}
