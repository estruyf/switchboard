import { useVirtualizer } from '@tanstack/react-virtual';
import { Archive, ArchiveRestore, Check, ChevronRight, FolderCog, GitBranch, House, Pin, PinOff, Plus, Search, Settings, Trash2 } from 'lucide-react';
import type { SidebarStyle } from '@switchboard/protocol/bridge';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { shortAge } from '../../lib/format.ts';
import { useCheckoutBranches } from '../../state/checkoutBranchesStore.ts';
import { isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions, type SessionRowData } from '../../state/sessionsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useSidebar } from '../../state/sidebarStore.ts';
import { SIDEBAR_DEFAULT_WIDTH } from '../../state/sidebarWidth.ts';
import { buildListRows, buildSessionList, GROUP_LABEL, inScope, isActive, rowStatus, sessionsByHeader, waitingLabel, type HeaderKey, type RowStatus, type SessionGroup, type SidebarListRow } from '../../state/sidebarRows.ts';
import { NO_PICKS, pickGroup, rangePick, stepPick, togglePick, visiblePicks, type Picks } from '../../state/sessionPicks.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { PROFILE_DOT } from '../profiles/ProfileBadge.tsx';
import { useMultipleProfiles, useProfile } from '../../state/profilesStore.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { updatePill } from '../../lib/updates.ts';
import { useUpdates } from '../../state/updatesStore.ts';
import { useClaudeUpdate } from '../../state/claudeUpdateStore.ts';
import { claudeUpdateNotice } from '../../lib/claudeUpdate.ts';
import { UpdatePillButton } from '../updates/UpdatePill.tsx';
import { ClaudeUpdatePill } from '../updates/ClaudeUpdatePill.tsx';
import { inWorktree } from '../worktree/branchMenu.ts';
import { ProjectFilter, useProjectIconEntries } from './ProjectMenu.tsx';
import { sessionRowLabel } from './rowLabel.ts';
import { StatusIcon } from './StatusIcon.tsx';

/** Drag the sidebar's right edge to resize it (clamped in the store); double-click resets the default width. */
function SidebarResizeHandle() {
  const setWidth = useSidebar((s) => s.setWidth);
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = useSidebar.getState().width;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => setWidth(startWidth + (e.clientX - startX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  return (
    <div
      onPointerDown={startResize}
      onDoubleClick={() => setWidth(SIDEBAR_DEFAULT_WIDTH)}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      data-tooltip="Drag to resize, double-click to reset"
      className="no-drag absolute inset-y-0 -right-[3px] z-20 w-1.5 cursor-col-resize hover:bg-accent/40"
      data-sidebar-resize
    />
  );
}

const SESSION_ROW_HEIGHT: Record<SidebarStyle, number> = { large: 52, standard: 48, compact: 34 };
const ARCHIVED_HEADER_HEIGHT = 34;
const GROUP_HEADER_HEIGHT = 34;
/** The space below each session button inside its row: picked rows fill it, so a run of picks reads as one block. */
const SESSION_ROW_GAP: Record<SidebarStyle, number> = { large: 4, standard: 4, compact: 2 };

const rowHeight = (row: SidebarListRow, style: SidebarStyle) =>
  row.kind === 'session' ? SESSION_ROW_HEIGHT[style] : row.kind === 'group' ? GROUP_HEADER_HEIGHT - (row.first ? 6 : 0) : ARCHIVED_HEADER_HEIGHT;

/** The 3px rail at a row's left edge: only the states that ask for a look get one. */
const RAIL_TONE: Partial<Record<Exclude<RowStatus, null>, string>> = { 'needs-you': 'bg-warn', running: 'bg-accent-ink', unread: 'bg-unread' };
const AGE_TONE: Partial<Record<Exclude<RowStatus, null>, string>> = { 'needs-you': 'text-warn', running: 'text-accent-ink', unread: 'text-unread' };

/** A section header in the list. Needs you and Working take their status colour and a count, so they read at a glance. */
function GroupHeader({ group, count, first, selectAll }: { group: SessionGroup; count: number; first: boolean; selectAll: ReactNode }) {
  const tone = group === 'needs-you' ? 'text-warn' : group === 'working' ? 'text-accent-ink' : 'text-faint';
  const pill = group === 'needs-you' ? 'bg-warn/15' : group === 'working' ? 'bg-accent/20' : null;
  return (
    <div className={`flex h-full items-end gap-1.5 px-2.5 ${first ? 'pb-1' : 'pb-1.5'} text-meta font-semibold tracking-wider uppercase ${tone}`} data-session-group={group}>
      <span role="heading" aria-level={2}>
        {GROUP_LABEL[group]}
        {pill && <span className="sr-only">, {count}</span>}
      </span>
      {pill && (
        <span className={`rounded-full px-1.5 tabular-nums tracking-normal ${pill}`} aria-hidden>
          {count}
        </span>
      )}
      {selectAll}
    </div>
  );
}

/** "Select all" on a header while picking: picks every session under it, or takes them all away again. */
function SelectAllButton({ group, all, onClick }: { group: HeaderKey; all: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      data-select-group={group}
      onClick={onClick}
      className="ml-auto self-center rounded px-1 text-ui font-medium tracking-normal text-link normal-case hover:underline"
    >
      {all ? 'Deselect all' : 'Select all'}
    </button>
  );
}

/** Where a project icon was, while picking: a round checkbox on every row, like Mail. A click toggles the row. */
function PickBox({ on, size, onToggle }: { on: boolean; size: number; onToggle(): void }) {
  return (
    <span
      data-pick-box={on}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-full ${on ? 'bg-accent text-on-accent' : 'border-[1.5px] border-faint/70 hover:border-text'}`}
      aria-hidden
    >
      {on && <Check size={Math.round(size * 0.62)} strokeWidth={3} />}
    </span>
  );
}

/** Re-renders relative ages (and the 48 h cut-off) once a minute. */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const SessionRow = memo(function SessionRow({
  data,
  selected,
  beside = false,
  archived,
  picked,
  picking,
  now,
  tabbable,
  waitingFor,
  onClick,
  onTogglePick,
  onMenu,
}: {
  data: SessionRowData;
  selected: boolean;
  /** Shown in the other (inactive) pane. */
  beside?: boolean;
  /** Listed under Archived. */
  archived: boolean;
  /** One of several sessions picked with ⌘- or ⇧-click. */
  picked: boolean;
  /** Several sessions are picked: every row shows a checkbox instead of its project icon. */
  picking: boolean;
  now: number;
  /** The list's one Tab stop (roving tabindex): ↑ ↓ move between rows from there. */
  tabbable: boolean;
  /** For a session waiting for you: what it asks for ("Permission: Bash", "Question"). */
  waitingFor: string | null;
  onClick(event: MouseEvent, data: SessionRowData): void;
  onTogglePick(id: string): void;
  onMenu(at: { x: number; y: number }, data: SessionRowData): void;
}) {
  const project = useProjects((s) => s.projects.get(data.projectRoot));
  const style = usePreferences((s) => s.prefs.sidebarStyle);
  // With a project filter on, every row is in that project: the name would only repeat.
  const filtered = useProjects((s) => s.filter !== null);
  const status = rowStatus(data);
  // A running session on its project's checkout: the branch the header read from git, once it has.
  const liveCwd = data.live?.cwd && !data.isWorktree && !inWorktree(data.live.cwd) ? data.live.cwd : null;
  const liveBranch = useCheckoutBranches((s) => (liveCwd && s.byCwd.has(liveCwd) ? (s.byCwd.get(liveCwd) ?? 'detached') : null));
  const branch = liveBranch ?? data.branch;
  const emphasised = status === 'needs-you' || status === 'running' || status === 'unread';
  const ageTone = (status && AGE_TONE[status]) ?? 'text-faint';
  const projectName = project?.name ?? data.projectRoot.split('/').pop();
  const titleTone = emphasised || selected ? 'font-semibold text-text' : archived ? 'text-muted' : 'text-text/85';
  const age = <span className={`shrink-0 text-meta tabular-nums ${ageTone}`}>{shortAge(data.updatedAt, now)}</span>;
  // The line at the row's left edge. With more than one Claude profile it is the profile's colour, on
  // every row, so you see whose account a session uses at a glance; the status then shows in the age's
  // colour, the bold title and the group. With one profile it is the status (needs you, working, unread).
  const multipleProfiles = useMultipleProfiles();
  const profile = useProfile(data.profileId);
  const statusRail = status && RAIL_TONE[status];
  const profileRail = multipleProfiles && profile ? PROFILE_DOT[profile.color] : null;
  const railTone = profileRail ?? statusRail;
  const rail = railTone && (
    <span
      className={`absolute inset-y-1.5 left-0 w-[3px] rounded-full ${railTone} ${archived && !selected ? 'opacity-50' : ''}`}
      data-profile-badge={profileRail && profile ? profile.id : undefined}
      aria-hidden
    />
  );
  const pin = data.pinned && <Pin size={11} className="shrink-0 text-faint" aria-hidden />;
  const icon = (size: number) =>
    picking ? (
      <PickBox on={picked} size={size} onToggle={() => onTogglePick(data.id)} />
    ) : (
      <span className={`flex shrink-0 ${archived && !selected ? 'opacity-60' : ''}`}>
        <ProjectIcon project={project} root={data.projectRoot} size={size} />
      </span>
    );
  // Below the row's corner, for menus opened from the keyboard (or VoiceOver, which sends a contextmenu at 0,0).
  const menuAt = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + 24, y: rect.top + Math.min(rect.height, 40) };
  };
  const common = {
    type: 'button' as const,
    'data-session-id': data.id,
    'data-in-app': data.inApp,
    tabIndex: tabbable ? 0 : -1,
    'aria-current': selected ? ('true' as const) : undefined,
    // The visible lines lean on icons, colour and short ages; this says the same in words.
    // Indexed sessions have a transcript, so they can be pinned and archived.
    'data-indexed': data.summary !== null,
    'data-picked': picked || undefined,
    'aria-label': sessionRowLabel({ title: data.title, project: projectName, status, pinned: data.pinned, archived, picked, beside, updatedAt: data.updatedAt, now }),
    onClick: (e: MouseEvent) => onClick(e, data),
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      e.preventDefault();
      onMenu(e.clientX === 0 && e.clientY === 0 ? menuAt(e.currentTarget) : { x: e.clientX, y: e.clientY }, data);
    },
    // ⇧F10 (and the menu key) open the same menu as a right-click. While picking, Space ticks the row's checkbox.
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
        e.preventDefault();
        onMenu(menuAt(e.currentTarget), data);
      } else if (e.key === ' ' && picking) {
        e.preventDefault();
        onTogglePick(data.id);
      }
    },
    'data-tooltip': [data.title, style === 'compact' ? projectName : null, style === 'compact' ? waitingFor : null, multipleProfiles && profile ? `Profile: ${profile.name}` : null, data.summary?.cwd].filter(Boolean).join('\n'),
  };
  // Selection is a neutral fill (a yellow tint vanishes on the light sidebar). Picked rows sit on a
  // tinted block the list draws behind them, so they need no fill of their own.
  const surface = picked
    ? ''
    : selected
      ? 'bg-selected'
      : beside
        ? 'bg-border/45 ring-1 ring-inset ring-border'
        : 'hover:bg-border/45';

  if (style === 'compact') {
    return (
      <button {...common} className={`relative flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-meta ${surface}`}>
        {rail}
        {icon(16)}
        <span className={`min-w-0 flex-1 truncate text-body ${titleTone}`}>{data.title}</span>
        {pin}
        {status ? <StatusIcon status={status} /> : age}
      </button>
    );
  }

  // Two lines: the title with its age, then what it waits for (needs you) or where it runs.
  const place = [branch, filtered ? null : projectName].filter(Boolean);
  const lines = (
    <span className="grid min-w-0 flex-1 gap-px">
      <span className="flex min-w-0 items-center gap-2">
        <span className={`min-w-0 flex-1 truncate text-body leading-5 ${titleTone}`}>{data.title}</span>
        {age}
      </span>
      <span className="flex h-4 min-w-0 items-center gap-1.5 text-meta text-faint">
        {waitingFor ? (
          <span className="min-w-0 flex-1 truncate font-medium text-warn">{waitingFor}</span>
        ) : (
          <>
            {status !== 'unread' && branch && <GitBranch size={11} className={`shrink-0 ${data.isWorktree ? 'text-accent-ink/80' : ''}`} aria-hidden />}
            {/* Finished with something you haven't read: say so where the branch would be. */}
            <span className="min-w-0 flex-1 truncate">{(status === 'unread' ? ['Finished, unread', filtered ? null : projectName].filter(Boolean) : place).join(' · ')}</span>
          </>
        )}
        {pin}
        {/* The rail and the age's colour already say needs you, working and unread; the icon is for the rest. */}
        {!statusRail && <StatusIcon status={status} />}
      </span>
    </span>
  );

  return (
    <button
      {...common}
      className={`relative flex w-full items-center gap-2.5 rounded-lg pr-2.5 pl-3 text-left ${style === 'large' ? 'h-12' : 'h-11'} ${surface}`}
    >
      {rail}
      {/* The project's icon tells rows from different projects apart inside a status group. */}
      {icon(style === 'large' ? 24 : 18)}
      {lines}
    </button>
  );
});

/**
 * A sentence for the sidebar's polite live region when a session starts waiting for you (a permission
 * or a question). Only new arrivals count, not the ones already waiting when the list loaded, and the
 * text clears after a while so the same session waiting again is announced again.
 */
function useWaitingAnnouncement(rows: SessionRowData[], loaded: boolean): string {
  const [notice, setNotice] = useState('');
  const seen = useRef<Set<string> | null>(null);
  const clear = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(clear.current), []);
  useEffect(() => {
    if (!loaded) return;
    const waiting = rows.filter((row) => row.live?.status === 'needs-you');
    const before = seen.current;
    seen.current = new Set(waiting.map((row) => row.id));
    const fresh = before ? waiting.filter((row) => !before.has(row.id)) : [];
    if (fresh.length === 0) return;
    setNotice(fresh.length === 1 ? `“${fresh[0]!.title}” is waiting for you.` : `${fresh.length} sessions are waiting for you.`);
    clearTimeout(clear.current);
    clear.current = setTimeout(() => setNotice(''), 5_000);
  }, [rows, loaded]);
  return notice;
}

export function Sidebar() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  const waiting = useHosts((s) => s.permissions.size);
  const search = useSessions((s) => s.filter);
  const selectedId = useSessions((s) => s.selectedId);
  const mainId = useSessions((s) => s.mainId);
  const splitId = useSessions((s) => s.splitId);
  const complete = useSessions((s) => s.complete);
  const loaded = useSessions((s) => s.loaded);
  const view = useSessions((s) => s.view);
  // Home is the main area with no session open (also behind Settings when it was opened from there).
  const atHome = useSessions((s) => (s.view === 'session' || (s.view === 'settings' && s.settingsFrom === 'session')) && s.mainId === null);
  // Settings is a sheet over the session, which stays selected in the list behind it.
  const listView = useSessions((s) => (s.view === 'settings' ? s.settingsFrom : s.view));
  const { setFilter: setSearch, select, setView } = useSessions.getState();
  const projectFilter = useProjects((s) => s.filter);
  const archivedOpen = useProjects((s) => s.archivedOpen);
  const { toggleArchived } = useProjects.getState();
  const noProjects = useProjects((s) => s.loaded && addedProjects(s.projects).length === 0);
  const openIn = useOpenIn();
  const projectIcons = useProjectIconEntries();
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[]; label: string } | null>(null);
  const [deleting, setDeleting] = useState<SessionRowData[] | null>(null);
  const [picks, setPicks] = useState<Picks>(NO_PICKS);
  const now = useNow();
  const sidebarStyle = usePreferences((s) => s.prefs.sidebarStyle);
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const updatePrefs = usePreferences((s) => s.update);
  const width = useSidebar((s) => s.width);

  const all = useMemo(() => toRows(sessions, live, hosts).filter((row) => inScope(row, scope)), [sessions, live, hosts, scope]);
  const { active, archived } = useMemo(() => buildSessionList(all, { search, project: projectFilter, now }), [all, search, projectFilter, now]);
  const counts = useMemo(() => {
    const map = new Map<string, { total: number; active: number }>();
    for (const row of all) {
      const entry = map.get(row.projectRoot) ?? { total: 0, active: 0 };
      entry.total++;
      if (isActive(row, now)) entry.active++;
      map.set(row.projectRoot, entry);
    }
    return map;
  }, [all, now]);

  // Sections (Needs you, Working, Today, Yesterday, Earlier), then Archived. While searching, archived matches are shown too.
  const rows = useMemo(
    () => buildListRows(active, archived, { now, archivedOpen: archivedOpen || search.trim() !== '' }),
    [active, archived, archivedOpen, search, now],
  );
  // What each waiting session asks for, from its oldest open request. Sessions waiting in another app have none.
  const permissions = useHosts((s) => s.permissions);
  const waitingTool = useMemo(() => {
    const map = new Map<string, { tool: string; at: number }>();
    for (const request of permissions.values()) {
      const seen = map.get(request.sessionId);
      if (!seen || request.createdAt < seen.at) map.set(request.sessionId, { tool: request.toolName, at: request.createdAt });
    }
    return map;
  }, [permissions]);

  // The sessions on screen, in list order: what ⇧-click ranges run over, and the picks that still count.
  const order = useMemo(() => rows.flatMap((r) => (r.kind === 'session' ? [r.data.id] : [])), [rows]);
  const picked = useMemo(() => new Set(visiblePicks(picks, order)), [picks, order]);
  const pickedRows = rows.flatMap((r) => (r.kind === 'session' && picked.has(r.data.id) ? [r.data] : []));
  const multi = picked.size > 1;
  const headerSessions = useMemo(() => sessionsByHeader(rows), [rows]);
  const togglePicked = (id: string) => setPicks((p) => togglePick(p, id, selectedId, order));
  /** "Select all" for a header while picking (Archived only while it's open, when its sessions are listed). */
  const selectAll = (group: HeaderKey) => {
    const ids = headerSessions.get(group) ?? [];
    if (!multi || ids.length === 0) return null;
    const all = ids.every((id) => picked.has(id));
    return <SelectAllButton group={group} all={all} onClick={() => setPicks((p) => pickGroup(p, ids, !all))} />;
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => rowHeight(rows[i]!, sidebarStyle),
    // Keyed by row, not index: archiving or unarchiving moves the headers without changing the count,
    // and the virtualiser only recomputes positions when the count or this function changes.
    getItemKey: useCallback((i: number) => {
      const row = rows[i]!;
      return row.kind === 'session' ? row.data.id : row.kind === 'group' ? `group-${row.group}` : 'archived-header';
    }, [rows]),
    overscan: 10,
  });
  // Row heights change with the sidebar style, and a header's height with its place (the first has less room above).
  useEffect(() => virtualizer.measure(), [sidebarStyle, rows, virtualizer]);

  // One Tab stop for the whole list: the selected row while it's rendered, else the first rendered one.
  const virtualItems = virtualizer.getVirtualItems();
  const renderedIds = virtualItems.flatMap((item) => {
    const row = rows[item.index];
    return row?.kind === 'session' ? [row.data.id] : [];
  });
  const tabStopId = listView === 'session' && selectedId && renderedIds.includes(selectedId) ? selectedId : (renderedIds[0] ?? null);

  const focusRow = (id: string) =>
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));

  // ⌘-click adds a row to the selection, ⇧-click selects a range, ⌥-click opens it in the other pane.
  const rowClick = (event: MouseEvent, data: SessionRowData) => {
    if (event.metaKey) togglePicked(data.id);
    else if (event.shiftKey) setPicks((p) => rangePick(p, data.id, selectedId, order));
    else {
      setPicks(NO_PICKS);
      if (event.altKey) useSessions.getState().openBeside(data.id);
      else select(data.id);
    }
  };

  // ↑/↓ moves through visible sessions, like a native source list (⇧ extends the selection); ⌘A picks the
  // focused row's group; ⌘⌫ deletes the picked sessions, or the selected one.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && picked.size > 0) {
      event.preventDefault();
      event.stopPropagation();
      setPicks(NO_PICKS);
      return;
    }
    if (event.key === 'a' && event.metaKey && !event.shiftKey && !event.altKey) {
      const focused = (event.target as HTMLElement).closest<HTMLElement>('[data-session-id]')?.dataset.sessionId ?? selectedId;
      const group = [...headerSessions.values()].find((ids) => focused && ids.includes(focused));
      if (group) {
        event.preventDefault();
        setPicks((p) => pickGroup(p, group));
      }
      return;
    }
    if (event.key === 'Backspace' && event.metaKey) {
      const selected = rows.find((r) => r.kind === 'session' && r.data.id === selectedId);
      const targets = multi ? pickedRows.filter((row) => row.summary) : selected?.kind === 'session' && selected.data.summary ? [selected.data] : [];
      if (targets.length) {
        event.preventDefault();
        setDeleting(targets);
      }
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (event.shiftKey) {
      const next = stepPick(picks, event.key === 'ArrowDown' ? 1 : -1, selectedId, order);
      if (!next?.end) return;
      setPicks(next);
      virtualizer.scrollToIndex(rows.findIndex((r) => r.kind === 'session' && r.data.id === next.end), { align: 'auto' });
      focusRow(next.end);
      return;
    }
    setPicks(NO_PICKS);
    const ids = rows.flatMap((r, index) => (r.kind === 'session' ? [{ id: r.data.id, index }] : []));
    if (ids.length === 0) return;
    const current = ids.findIndex((r) => r.id === selectedId);
    const next = ids[current === -1 ? 0 : Math.min(ids.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)))]!;
    select(next.id);
    virtualizer.scrollToIndex(next.index, { align: 'auto' });
    // Focus follows the selection, so VoiceOver reads the new row and Tab stays where you are.
    focusRow(next.id);
  };

  type FlagChange = { pinned?: boolean; archived?: boolean };
  // Only indexed sessions have flags; a session still starting has nothing to keep them against.
  const flagAll = (targets: SessionRowData[], change: FlagChange) => {
    for (const target of targets) if (target.summary) void client?.call('sessions.setFlags', { sessionId: target.id, ...change });
  };
  const ARCHIVE: FlagChange = { archived: true, pinned: false };

  // What the picked sessions can do: only indexed ones have flags and a transcript to delete.
  const pickTargets = pickedRows.filter((row) => row.summary);
  const pickActive = pickTargets.filter((row) => isActive(row, now));
  const pickArchived = pickTargets.filter((row) => !isActive(row, now));
  const allPinned = pickTargets.length > 0 && pickTargets.every((row) => row.pinned);
  const actOnPicks = (targets: SessionRowData[], change: FlagChange) => () => {
    flagAll(targets, change);
    setPicks(NO_PICKS);
  };

  /** The menu for several picked sessions: the same actions as the selection bar. */
  const pickedMenu = (at: { x: number; y: number }) => {
    const count = (rows: SessionRowData[]) => `${rows.length} ${rows.length === 1 ? 'session' : 'sessions'}`;
    const entries: MenuEntry[] = [{ heading: `${picked.size} selected` }];
    if (pickActive.length) entries.push({ label: `Archive ${count(pickActive)}`, hint: 'until new activity', onSelect: actOnPicks(pickActive, ARCHIVE) });
    if (pickArchived.length) entries.push({ label: `Unarchive ${count(pickArchived)}`, onSelect: actOnPicks(pickArchived, { archived: false }) });
    if (pickTargets.length) entries.push({ label: `${allPinned ? 'Unpin' : 'Pin'} ${count(pickTargets)}`, onSelect: actOnPicks(pickTargets, { pinned: !allPinned }) });
    entries.push('separator', { label: 'Clear selection', hint: 'Esc', onSelect: () => setPicks(NO_PICKS) });
    if (pickTargets.length) entries.push('separator', { label: `Delete ${count(pickTargets)}…`, hint: '⌘⌫', danger: true, onSelect: () => setDeleting(pickTargets) });
    setMenu({ ...at, label: `${picked.size} selected sessions`, entries });
  };

  const sessionMenu = (at: { x: number; y: number }, data: SessionRowData) => {
    if (multi && picked.has(data.id)) return pickedMenu(at);
    setPicks(NO_PICKS);
    const archivedNow = !isActive(data, Date.now());
    const flag = (change: FlagChange) => flagAll([data], change);
    const cwd = data.summary?.cwd ?? data.live?.cwd ?? null;
    setMenu({
      ...at,
      label: `Session “${data.title}”`,
      entries: [
        { label: data.pinned ? 'Unpin' : 'Pin to top', onSelect: () => flag({ pinned: !data.pinned }), disabled: !data.summary },
        archivedNow
          ? { label: 'Unarchive', onSelect: () => flag({ archived: false }), disabled: !data.summary }
          : { label: 'Archive', hint: 'until new activity', onSelect: () => flag(ARCHIVE), disabled: !data.summary },
        { label: 'Open beside', hint: '⌥-click', onSelect: () => useSessions.getState().openBeside(data.id) },
        { label: 'Open folder in editor', onSelect: () => cwd && void openIn(cwd).catch(() => {}), disabled: !cwd },
        { label: 'Copy session ID', onSelect: () => void navigator.clipboard.writeText(data.id) },
        'separator',
        ...projectIcons.entries(data.projectRoot, at),
        'separator',
        { label: 'Delete session…', hint: '⌘⌫', danger: true, disabled: !data.summary, onSelect: () => setDeleting([data]) },
      ],
    });
  };

  // Only open sessions the main list shows: a process idling elsewhere sits under Archived and
  // would make the count disagree with what's visible.
  const liveCount = all.filter((row) => row.live !== null && isActive(row, now)).length;
  const waitingNotice = useWaitingAnnouncement(all, loaded);
  const hasUpdatePill = useUpdates((s) => updatePill(s.state) !== null);
  const hasClaudePill = useClaudeUpdate((s) => claudeUpdateNotice(s.state) !== null);

  return (
    <aside aria-label="Sidebar" className="relative flex shrink-0 flex-col border-r border-border bg-sidebar" style={{ width }} data-sidebar>
      {/* Traffic lights on the left; the bar doubles as a window drag handle. */}
      <div className="drag flex h-13 shrink-0 items-center gap-2 pl-24">
        <span className="text-body font-semibold text-text/90">Switchboard</span>
      </div>

      {/* The session list stays while Settings is open (a sheet over the main area), so "Needs you" stays in view. */}
      <div className="flex items-center gap-1.5 px-3 pb-1.5">
        {/* A real field on the darkest surface, so it reads as the place to type. */}
        <label className="no-drag flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-bg px-2.5 text-faint focus-within:ring-1 focus-within:ring-accent-ink/50">
          <Search size={14} className="shrink-0" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions by title, project or branch"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-ui text-text outline-none placeholder:text-muted"
          />
        </label>
        <button
          type="button"
          data-go-home
          onClick={() => useSessions.getState().goHome()}
          data-tooltip="Home (⌘⇧H)" aria-label="Home (⌘⇧H)"
          aria-current={atHome ? 'page' : undefined}
          className={`no-drag flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-border/50 ${atHome ? 'bg-selected text-text' : 'text-muted hover:text-text'}`}
        >
          <House size={15} aria-hidden />
        </button>
        <button
          type="button"
          data-new-session
          onClick={() => useSessions.getState().openNewSession()}
          data-tooltip="New session (⌘N)" aria-label="New session (⌘N)"
          // The sidebar's one primary action: a yellow fill, like every primary button.
          className={`no-drag flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent hover:bg-accent/85 ${view === 'new' ? 'ring-2 ring-accent/40 ring-offset-1 ring-offset-sidebar' : ''}`}
        >
          <Plus size={17} strokeWidth={2.4} aria-hidden />
        </button>
      </div>

      <ProjectFilter counts={counts} />
      {noProjects && (
        <div className="mx-3 mb-2 grid justify-items-start gap-1 rounded-lg border border-dashed border-border px-3 py-2.5 text-ui" data-sidebar-onboarding>
          <p className="font-medium text-text">Add a project</p>
          <p className="text-muted">Choose the folders you work in. They are offered when you start a session.</p>
          <button type="button" onClick={() => useProjects.getState().showAdd(true)} className="mt-1 text-link hover:underline">
            Add project…
          </button>
        </div>
      )}

      {/* Keys go to the list and the selection bar floating over it, so Esc clears picks from either. */}
      <div onKeyDown={onKeyDown} className="relative flex min-h-0 flex-1 flex-col">
      {/* While picking, the list scrolls far enough for its last rows to clear the floating bar. */}
      <div ref={scrollRef} className={`min-h-0 flex-1 overflow-y-auto px-2 ${multi ? 'pb-36' : 'pb-2'}`} data-session-list>
        {loaded && rows.length === 0 ? (
          <div className="grid justify-items-start gap-2 px-2 py-4 text-ui text-muted" data-empty-sidebar>
            <p>
              {search
                ? `No sessions match “${search.trim()}”. Search looks at titles, projects and branches; ⌘⇧F searches inside conversations.`
                : projectFilter
                  ? 'No sessions in this project yet. Start one with ⌘N.'
                  : scope === 'switchboard'
                    ? 'Sessions you start or continue in Switchboard show up here. Start one with ⌘N.'
                    : 'No Claude Code sessions found yet. Start one with ⌘N.'}
            </p>
            {search && (
              <button type="button" onClick={() => setSearch('')} className="text-link hover:underline">
                Clear search
              </button>
            )}
            {scope === 'switchboard' && sessions.size > 0 && (
              <button type="button" onClick={() => updatePrefs({ sessionScope: 'all' })} className="text-link hover:underline">
                Show sessions from other apps
              </button>
            )}
          </div>
        ) : (
          // Virtualised: only rows near the viewport exist, so each item says where it sits in the whole list.
          <div role="list" aria-label="Sessions" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualItems.map((item) => {
              const row = rows[item.index]!;
              const isPicked = (r: SidebarListRow | undefined) => multi && r?.kind === 'session' && picked.has(r.data.id);
              // A run of picked rows shares one tinted block: rounded where the run starts and ends.
              const block = isPicked(row) && { top: !isPicked(rows[item.index - 1]), bottom: !isPicked(rows[item.index + 1]) };
              return (
                <div
                  key={item.key}
                  role="listitem"
                  aria-setsize={rows.length}
                  aria-posinset={item.index + 1}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  {block && (
                    <div
                      aria-hidden
                      data-pick-block
                      className={`absolute inset-x-0 top-0 border-x border-accent-ink/25 bg-accent-ink/10 ${block.top ? 'rounded-t-lg border-t' : ''} ${block.bottom ? 'rounded-b-lg border-b' : ''}`}
                      style={{ bottom: block.bottom ? SESSION_ROW_GAP[sidebarStyle] : 0 }}
                    />
                  )}
                  {row.kind === 'group' ? (
                    <GroupHeader group={row.group} count={row.count} first={row.first} selectAll={selectAll(row.group)} />
                  ) : row.kind === 'session' ? (
                    <SessionRow
                      data={row.data}
                      archived={row.archived}
                      picked={multi && picked.has(row.data.id)}
                      picking={multi}
                      selected={listView === 'session' && row.data.id === selectedId}
                      beside={listView === 'session' && splitId !== null && row.data.id !== selectedId && (row.data.id === mainId || row.data.id === splitId)}
                      now={now}
                      tabbable={row.data.id === tabStopId}
                      waitingFor={rowStatus(row.data) === 'needs-you' ? waitingLabel(waitingTool.get(row.data.id)?.tool ?? null) : null}
                      onClick={rowClick}
                      onTogglePick={togglePicked}
                      onMenu={sessionMenu}
                    />
                  ) : (
                    <div className="mt-2 flex h-[26px] items-center pr-1">
                      <button
                        type="button"
                        data-archived-toggle
                        data-open={row.open}
                        aria-expanded={row.open}
                        onClick={toggleArchived}
                        data-tooltip="Quiet for 48 hours, or archived by you. They come back when there is something new."
                        // Styled like the group headers above it, with the count in the same pill.
                        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-2.5 text-meta font-semibold tracking-wider text-faint uppercase hover:text-text"
                      >
                        Archived
                        <span className="rounded-full bg-border/60 px-1.5 tabular-nums tracking-normal">{row.count}</span>
                        <ChevronRight size={13} className={`transition-transform ${row.open ? 'rotate-90' : ''}`} aria-hidden />
                      </button>
                      {selectAll('archived')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {multi && (
        // Floats over the list's bottom edge, like a sheet, and holds every action for the picks with its keys.
        <div className="absolute inset-x-2 bottom-2 z-10 grid gap-2 rounded-xl border overlay p-2.5" role="toolbar" aria-label="Selected sessions" data-selection-bar>
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-meta font-semibold tabular-nums text-on-accent" data-selection-count={picked.size}>
              {picked.size}
            </span>
            <span className="min-w-0 flex-1 truncate text-ui font-semibold text-text">sessions selected</span>
            <button type="button" onClick={() => setPicks(NO_PICKS)} data-clear-selection className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-ui text-muted hover:bg-border/50 hover:text-text">
              Clear <kbd className="rounded border border-edge px-1 font-sans text-meta">Esc</kbd>
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {pickActive.length > 0 || pickArchived.length === 0 ? (
              <button type="button" data-archive-selected disabled={pickActive.length === 0} onClick={actOnPicks(pickActive, ARCHIVE)} className="btn-secondary min-w-0 px-1.5">
                <Archive size={13} className="shrink-0" aria-hidden /> <span className="truncate">Archive</span>
              </button>
            ) : (
              <button type="button" data-unarchive-selected onClick={actOnPicks(pickArchived, { archived: false })} className="btn-secondary min-w-0 px-1.5">
                <ArchiveRestore size={13} className="shrink-0" aria-hidden /> <span className="truncate">Unarchive</span>
              </button>
            )}
            <button type="button" data-pin-selected disabled={pickTargets.length === 0} onClick={actOnPicks(pickTargets, { pinned: !allPinned })} className="btn-secondary min-w-0 px-1.5">
              {allPinned ? <PinOff size={13} className="shrink-0" aria-hidden /> : <Pin size={13} className="shrink-0" aria-hidden />}
              <span className="truncate">{allPinned ? 'Unpin' : 'Pin'}</span>
            </button>
            <button
              type="button"
              data-delete-selected
              disabled={pickTargets.length === 0}
              onClick={() => setDeleting(pickTargets)}
              className="btn-secondary min-w-0 border-error/50! px-1.5 text-error! hover:bg-error/10!"
            >
              <Trash2 size={13} className="shrink-0" aria-hidden /> <span className="truncate">Delete…</span>
            </button>
          </div>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-meta text-faint">
            {[['⌘A', 'all in group'], ['⇧↑↓', 'extend'], ['⌘⌫', 'delete']].map(([key, what]) => (
              <span key={key} className="flex items-center gap-1">
                <kbd className="rounded border border-edge px-1 font-sans">{key}</kbd> {what}
              </span>
            ))}
          </p>
        </div>
      )}
      </div>

      <footer className="flex h-10 shrink-0 items-center gap-2 border-t border-border px-3 text-meta text-muted">
        {/* An update to act on takes the footer's place (Switchboard's first); the session count is the lesser news. */}
        {hasUpdatePill ? (
          <div className="flex min-w-0 flex-1">
            <UpdatePillButton />
          </div>
        ) : hasClaudePill ? (
          <div className="flex min-w-0 flex-1">
            <ClaudeUpdatePill />
          </div>
        ) : (
          <span className="min-w-0 flex-1 truncate">
            {all.length} {all.length === 1 ? 'session' : 'sessions'}{liveCount > 0 && ` · ${liveCount} open`}
            {waiting > 0 && <span className="text-warn">{` · ${waiting} waiting`}</span>}
            {!complete && loaded && ' · scanning…'}
          </span>
        )}
        <button
          type="button"
          data-open-projects
          onClick={() => setView(view === 'projects' ? 'session' : 'projects')}
          data-tooltip="Projects" aria-label="Projects"
          className={`flex size-7 items-center justify-center rounded-md hover:bg-border/60 hover:text-text ${view === 'projects' ? 'bg-border/60 text-text' : 'text-muted'}`}
        >
          <FolderCog size={15} aria-hidden />
        </button>
        <button
          type="button"
          data-open-settings
          onClick={() => (view === 'settings' ? useSessions.getState().closeSettings() : useSessions.getState().openSettings())}
          data-tooltip="Settings (⌘,)" aria-label="Settings (⌘,)"
          className={`flex size-7 items-center justify-center rounded-md hover:bg-border/60 hover:text-text ${view === 'settings' ? 'bg-border/60 text-text' : 'text-muted'}`}
        >
          <Settings size={15} aria-hidden />
        </button>
      </footer>

      {menu && <Menu x={menu.x} y={menu.y} entries={menu.entries} label={menu.label} onClose={() => setMenu(null)} />}
      {/* Says when a session starts waiting for you; the row's icon alone can't be heard. */}
      <p className="sr-only" aria-live="polite" data-waiting-announcement>
        {waitingNotice}
      </p>
      {deleting && (
        <ConfirmDialog
          title={
            deleting.length === 1
              ? `Delete “${deleting[0]!.title.length > 60 ? `${deleting[0]!.title.slice(0, 59)}…` : deleting[0]!.title}”?`
              : `Delete ${deleting.length} sessions?`
          }
          danger
          confirmLabel="Move to Trash"
          blockedReason={
            deleting.some((target) => target.live && !isActiveHost(hosts.get(target.id)))
              ? deleting.length === 1
                ? 'This session is open in another Claude Code window. Close it there first.'
                : 'Some of these sessions are open in another Claude Code window. Close them there first.'
              : null
          }
          body={
            <>
              {deleting.length === 1 ? 'The conversation and any subagent transcripts move' : 'The conversations and any subagent transcripts move'} to the Trash, so you can
              restore them from Finder. Files Claude changed in your project are not touched.
              {deleting.some((target) => isActiveHost(hosts.get(target.id))) &&
                (deleting.length === 1 ? ' It is running in Switchboard and will be stopped first.' : ' Sessions running in Switchboard will be stopped first.')}
            </>
          }
          onConfirm={async () => {
            if (!client) throw new Error('Not connected to the engine');
            const gone = new Set(deleting.map((target) => target.id));
            // Keep the cursor in the list: the next session that stays (or the previous one at the end).
            const index = selectedId ? order.indexOf(selectedId) : -1;
            const next = index === -1 ? null : (order.slice(index + 1).find((id) => !gone.has(id)) ?? order.slice(0, index).reverse().find((id) => !gone.has(id)) ?? null);
            for (const target of deleting) {
              await client.call('session.delete', { sessionId: target.id });
              const panes = useSessions.getState();
              // Two panes: the other one takes the full width.
              if (panes.splitId && (target.id === panes.mainId || target.id === panes.splitId)) panes.closePane(target.id === panes.mainId ? 'main' : 'split');
            }
            setPicks(NO_PICKS);
            const current = useSessions.getState().selectedId;
            if (current === null ? selectedId !== null && gone.has(selectedId) : gone.has(current)) {
              if (next) select(next);
              else setView('session');
            }
          }}
          onClose={() => setDeleting(null)}
        />
      )}
      {projectIcons.picker}
      <SidebarResizeHandle />
    </aside>
  );
}
