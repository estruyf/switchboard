import type { SessionScope, StartupView } from '@switchboard/protocol/bridge';
import type { LaterItem } from '@switchboard/protocol/client';
import type { SessionRowData } from './sessionsStore.ts';

/** What the status icon on a row shows, most urgent first. */
export type RowStatus = 'needs-you' | 'running' | 'error' | 'unread' | 'background' | 'idle' | null;

export function rowStatus(row: SessionRowData): RowStatus {
  if (row.live?.status === 'needs-you') return 'needs-you';
  if (row.live?.status === 'running') return 'running';
  if (row.error) return 'error';
  if (row.unread) return 'unread';
  // Idle between turns, but a background command or agent is still working.
  if (row.live?.status === 'idle' && row.live.background?.length) return 'background';
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
 * Main list or "Archived"? Anything that wants attention (working, waiting,
 * failed, unread, open in Switchboard) or is pinned stays up. Archiving by hand hides a
 * session until it has new activity; otherwise sessions are archived after 48 h.
 */
export function isActive(row: SessionRowData, now: number): boolean {
  // Anything that needs you always shows.
  if (row.live?.status === 'needs-you' || row.error) return true;
  if (row.pinned) return true;
  // Archived by hand: hidden until there's something new to see. A session that's still
  // working stays archived (its constant updates aren't news); it comes back once it finishes.
  if (row.archivedAt !== null && (row.archivedAt >= row.updatedAt || row.live?.status === 'running')) return false;
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

/** Splits sessions into the main list (pinned first, then newest) and the archived list (newest first). */
export function buildSessionList(
  rows: readonly SessionRowData[],
  options: SessionListOptions,
): { active: SessionRowData[]; archived: SessionRowData[] } {
  const needle = options.search.trim().toLowerCase();
  const active: SessionRowData[] = [];
  const archived: SessionRowData[] = [];
  for (const row of rows) {
    if (options.scope && !inScope(row, options.scope)) continue;
    if (options.project && row.projectRoot !== options.project) continue;
    if (needle && !matches(row, needle)) continue;
    (isActive(row, options.now) ? active : archived).push(row);
  }
  active.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  archived.sort((a, b) => b.updatedAt - a.updatedAt);
  return { active, archived };
}

/** The sections of the main list, in the order they show: what needs attention first, then by time. */
export type SessionGroup = 'needs-you' | 'working' | 'today' | 'yesterday' | 'earlier';

export const GROUP_LABEL: Record<SessionGroup, string> = {
  'needs-you': 'Needs you',
  working: 'Working',
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
};

const GROUP_ORDER: readonly SessionGroup[] = ['needs-you', 'working', 'today', 'yesterday', 'earlier'];

/** Local midnight of the day `now` falls on, so "Today" matches the calendar rather than the last 24 hours. */
export function startOfDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Which section a main-list session sits in. */
export function sessionGroup(row: SessionRowData, now: number): SessionGroup {
  const status = rowStatus(row);
  if (status === 'needs-you') return 'needs-you';
  if (status === 'running') return 'working';
  const today = startOfDay(now);
  if (row.updatedAt >= today) return 'today';
  // The day before today; a day can be 23 or 25 hours long across a clock change, hence the second midnight.
  if (row.updatedAt >= startOfDay(today - 1)) return 'yesterday';
  return 'earlier';
}

/**
 * When a working session's turn began: when you last sent it a message (Claude Code's registry: when it
 * went busy). The Working list orders by this rather than by the last write, which moves all the time.
 */
export const workingSince = (row: SessionRowData): number => row.live?.updatedAt ?? row.live?.startedAt ?? row.updatedAt;

/** Working sessions, pinned first, then the one you set going last. */
export const byWorkingSince = (a: SessionRowData, b: SessionRowData): number => Number(b.pinned) - Number(a.pinned) || workingSince(b) - workingSince(a);

/**
 * Splits the main list into its sections, skipping empty ones. The order inside a section is the
 * order given (buildSessionList puts pinned sessions first, then newest), so pins stay on top of their section.
 * Working is the exception: it keeps the order you started its sessions in (`byWorkingSince`).
 */
export function groupSessions(active: readonly SessionRowData[], now: number): { group: SessionGroup; rows: SessionRowData[] }[] {
  const buckets = new Map<SessionGroup, SessionRowData[]>();
  for (const row of active) {
    const group = sessionGroup(row, now);
    const bucket = buckets.get(group);
    if (bucket) bucket.push(row);
    else buckets.set(group, [row]);
  }
  buckets.get('working')?.sort(byWorkingSince);
  return GROUP_ORDER.flatMap((group) => {
    const rows = buckets.get(group);
    return rows ? [{ group, rows }] : [];
  });
}

/** One row of the virtualised sidebar list: a session, a section header, a prompt saved for later, or a collapsible header. */
export type SidebarListRow =
  | { kind: 'session'; data: SessionRowData; archived: boolean }
  | { kind: 'group'; group: SessionGroup; count: number; first: boolean }
  | { kind: 'later-header'; count: number; open: boolean; first: boolean }
  | { kind: 'later'; item: LaterItem }
  | { kind: 'archived'; count: number; open: boolean };

/**
 * The flat row list the sidebar virtualises: each non-empty section under its header, then the Later
 * list (prompts saved for later, when there are any), then Archived.
 */
export function buildListRows(
  active: readonly SessionRowData[],
  archived: readonly SessionRowData[],
  options: { now: number; archivedOpen: boolean; later?: { items: readonly LaterItem[]; open: boolean } },
): SidebarListRow[] {
  const list: SidebarListRow[] = [];
  for (const { group, rows } of groupSessions(active, options.now)) {
    list.push({ kind: 'group', group, count: rows.length, first: list.length === 0 });
    for (const data of rows) list.push({ kind: 'session', data, archived: false });
  }
  const later = options.later;
  if (later && later.items.length) {
    list.push({ kind: 'later-header', count: later.items.length, open: later.open, first: list.length === 0 });
    if (later.open) for (const item of later.items) list.push({ kind: 'later', item });
  }
  if (archived.length) list.push({ kind: 'archived', count: archived.length, open: options.archivedOpen });
  if (options.archivedOpen) for (const data of archived) list.push({ kind: 'session', data, archived: true });
  return list;
}

/** What a waiting session asks for, in a few words for its row: the question, a plan, or the tool it wants to run. */
export function waitingLabel(toolName: string | null): string {
  if (toolName === null) return 'Waiting for you';
  if (toolName === 'AskUserQuestion') return 'Question';
  if (toolName === 'ExitPlanMode') return 'Plan to review';
  return `Permission: ${toolName}`;
}

/** Prompts saved for later that the sidebar lists: the project filter applies, and search looks at the prompt and the folder. */
export function laterInList(items: readonly LaterItem[], options: { search: string; project: string | null }): LaterItem[] {
  const needle = options.search.trim().toLowerCase();
  return items.filter(
    (item) => (!options.project || item.cwd === options.project) && (!needle || item.prompt.toLowerCase().includes(needle) || item.cwd.toLowerCase().includes(needle)),
  );
}

/** The key of a header row in the list: its group, or 'archived'. */
export type HeaderKey = SessionGroup | 'archived';

/** The sessions under each header, in list order: what ⌘A and a header's "Select all" pick. */
export function sessionsByHeader(rows: readonly SidebarListRow[]): Map<HeaderKey, string[]> {
  const map = new Map<HeaderKey, string[]>();
  let ids: string[] | null = null;
  for (const row of rows) {
    if (row.kind === 'session') ids?.push(row.data.id);
    else if (row.kind === 'group' || row.kind === 'archived') map.set(row.kind === 'group' ? row.group : 'archived', (ids = []));
    // Saved prompts aren't sessions: nothing under the Later header can be picked.
    else if (row.kind === 'later-header') ids = null;
  }
  return map;
}
