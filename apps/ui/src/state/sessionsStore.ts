import { create } from 'zustand';
import type { LiveSession, SessionsChanged, SessionsSnapshot, SessionSummary } from '@switchboard/protocol/client';

export type MainView = 'session' | 'diagnostics';

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
  collapsed: Set<string>;
  /** Projects showing all their sessions instead of the newest few. */
  expanded: Set<string>;

  applySnapshot(snapshot: SessionsSnapshot): void;
  applyChanged(change: SessionsChanged): void;
  setLive(live: LiveSession[]): void;
  select(id: string | null): void;
  setView(view: MainView): void;
  setFilter(filter: string): void;
  toggleCollapsed(projectRoot: string): void;
  toggleExpanded(projectRoot: string): void;
}

/** Claude Code records `HEAD` when there is no branch (e.g. before the first commit); that is not a name worth showing. */
export const realBranch = (branch: string | null) => (branch && branch !== 'HEAD' ? branch : null);

const toggle = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

export const useSessions = create<SessionsState>()((set) => ({
  sessions: new Map(),
  live: new Map(),
  complete: false,
  loaded: false,
  selectedId: null,
  view: 'session',
  filter: '',
  collapsed: new Set(),
  expanded: new Set(),

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
  toggleCollapsed: (root) => set((state) => ({ collapsed: toggle(state.collapsed, root) })),
  toggleExpanded: (root) => set((state) => ({ expanded: toggle(state.expanded, root) })),
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
}

export function toRows(sessions: Map<string, SessionSummary>, live: Map<string, LiveSession>): SessionRowData[] {
  const rows: SessionRowData[] = [];
  for (const s of sessions.values()) {
    const l = live.get(s.id) ?? null;
    rows.push({
      id: s.id,
      title: l?.name && !s.customTitle ? l.name : s.title,
      projectRoot: s.projectRoot,
      updatedAt: Math.max(s.updatedAt, l?.updatedAt ?? 0),
      branch: s.worktree?.branch ?? realBranch(s.gitBranch),
      isWorktree: s.worktree !== null,
      live: l,
      summary: s,
    });
  }
  // Running sessions that have not written a transcript yet still deserve a row.
  for (const l of live.values()) {
    if (sessions.has(l.sessionId)) continue;
    rows.push({
      id: l.sessionId,
      title: l.name ?? 'New session',
      projectRoot: l.projectRoot ?? l.cwd ?? 'Unknown folder',
      updatedAt: l.updatedAt ?? l.startedAt ?? Date.now(),
      branch: null,
      isWorktree: false,
      live: l,
      summary: null,
    });
  }
  return rows;
}
