import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, FolderCog, GitBranch, Pin, Search, Settings, SquarePen } from 'lucide-react';
import type { SidebarStyle } from '@switchboard/protocol/bridge';
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { shortAge } from '../../lib/format.ts';
import { isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions, type SessionRowData } from '../../state/sessionsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useSidebar } from '../../state/sidebarStore.ts';
import { SIDEBAR_DEFAULT_WIDTH } from '../../state/sidebarWidth.ts';
import { buildSessionList, inScope, isActive, rowStatus } from '../../state/sidebarRows.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { ProfileBadge } from '../profiles/ProfileBadge.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { SettingsNav } from '../SettingsView.tsx';
import { updatePill } from '../../lib/updates.ts';
import { useUpdates } from '../../state/updatesStore.ts';
import { UpdatePillButton } from '../updates/UpdatePill.tsx';
import { ProjectFilter, useProjectIconEntries } from './ProjectMenu.tsx';
import { StatusIcon } from './StatusIcon.tsx';
import appIcon from '../../assets/app-icon.png';

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

type ListRow = { kind: 'session'; data: SessionRowData; settled: boolean } | { kind: 'settled-header'; count: number; open: boolean };

const SESSION_ROW_HEIGHT: Record<SidebarStyle, number> = { large: 70, standard: 70, compact: 36 };
const SETTLED_HEADER_HEIGHT = 34;

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
  settled,
  now,
  onContextMenu,
}: {
  data: SessionRowData;
  selected: boolean;
  /** Shown in the other (inactive) pane. */
  beside?: boolean;
  settled: boolean;
  now: number;
  onContextMenu(event: MouseEvent, data: SessionRowData): void;
}) {
  const select = useSessions((s) => s.select);
  const project = useProjects((s) => s.projects.get(data.projectRoot));
  const style = usePreferences((s) => s.prefs.sidebarStyle);
  const status = rowStatus(data);
  const emphasised = status !== null && status !== 'idle';
  const ageTone = status === 'needs-you' ? 'text-warn' : status === 'running' || status === 'unread' ? 'text-accent-ink' : 'text-faint';
  const projectName = project?.name ?? data.projectRoot.split('/').pop();
  const titleTone = emphasised || selected ? 'font-semibold text-text' : settled ? 'text-muted' : 'text-text/80';
  const age = <span className={`shrink-0 tabular-nums ${ageTone}`}>{shortAge(data.updatedAt, now)}</span>;
  const pin = data.pinned && <Pin size={11} className="shrink-0 text-faint" aria-label="Pinned" />;
  const common = {
    type: 'button' as const,
    'data-session-id': data.id,
    'data-in-app': data.inApp,
    // ⌥-click opens the session in the other pane.
    onClick: (e: MouseEvent) => (e.altKey ? useSessions.getState().openBeside(data.id) : select(data.id)),
    onContextMenu: (e: MouseEvent) => onContextMenu(e, data),
    title: [data.title, style === 'compact' ? projectName : null, data.summary?.cwd].filter(Boolean).join('\n'),
  };
  const surface = selected ? 'bg-accent/15' : beside ? 'bg-border/45 ring-1 ring-inset ring-border' : 'hover:bg-border/45';

  if (style === 'compact') {
    return (
      <button {...common} className={`flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[11px] ${surface}`}>
        <ProjectIcon project={project} root={data.projectRoot} size={16} />
        <span className={`min-w-0 flex-1 truncate text-[13px] ${titleTone}`}>{data.title}</span>
        <ProfileBadge profileId={data.profileId} dotOnly />
        {pin}
        {status ? <StatusIcon status={status} /> : age}
      </button>
    );
  }

  const lines = (
    <>
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
        {style === 'standard' && <ProjectIcon project={project} root={data.projectRoot} size={13} />}
        <span className="min-w-0 flex-1 truncate">{projectName}</span>
        <ProfileBadge profileId={data.profileId} className="max-w-24" />
        {pin}
        {age}
      </span>
      <span className={`min-w-0 truncate text-[13px] leading-5 ${titleTone}`}>{data.title}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-faint">
        {data.branch && (
          <>
            <GitBranch size={11} className={`shrink-0 ${data.isWorktree ? 'text-accent-ink/80' : ''}`} aria-label={data.isWorktree ? 'Worktree' : 'Branch'} />
            <span className="min-w-0 truncate">{data.branch}</span>
          </>
        )}
        <span className="flex-1" />
        <StatusIcon status={status} />
      </span>
    </>
  );

  if (style === 'large') {
    return (
      <button {...common} className={`flex h-[66px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left ${surface}`}>
        <ProjectIcon project={project} root={data.projectRoot} size={34} />
        <span className="grid min-w-0 flex-1 grid-rows-3">{lines}</span>
      </button>
    );
  }

  return (
    <button {...common} className={`grid h-[66px] w-full grid-rows-3 rounded-lg px-2.5 py-1.5 text-left ${surface}`}>
      {lines}
    </button>
  );
});

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
  const { setFilter: setSearch, select, setView } = useSessions.getState();
  const projectFilter = useProjects((s) => s.filter);
  const settledOpen = useProjects((s) => s.settledOpen);
  const toggleSettled = useProjects((s) => s.toggleSettled);
  const noProjects = useProjects((s) => s.loaded && addedProjects(s.projects).length === 0);
  const openIn = useOpenIn();
  const projectIcons = useProjectIconEntries();
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [deleting, setDeleting] = useState<SessionRowData | null>(null);
  const now = useNow();
  const sidebarStyle = usePreferences((s) => s.prefs.sidebarStyle);
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const updatePrefs = usePreferences((s) => s.update);
  const width = useSidebar((s) => s.width);

  const all = useMemo(() => toRows(sessions, live, hosts).filter((row) => inScope(row, scope)), [sessions, live, hosts, scope]);
  const { active, settled } = useMemo(() => buildSessionList(all, { search, project: projectFilter, now }), [all, search, projectFilter, now]);
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

  const rows = useMemo<ListRow[]>(() => {
    const list: ListRow[] = active.map((data) => ({ kind: 'session', data, settled: false }));
    // While searching, settled matches are shown too.
    const showSettled = settledOpen || search.trim() !== '';
    if (settled.length) list.push({ kind: 'settled-header', count: settled.length, open: showSettled });
    if (showSettled) for (const data of settled) list.push({ kind: 'session', data, settled: true });
    return list;
  }, [active, settled, settledOpen, search]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]!.kind === 'session' ? SESSION_ROW_HEIGHT[sidebarStyle] : SETTLED_HEADER_HEIGHT),
    overscan: 10,
  });
  // Row heights change with the sidebar style.
  useEffect(() => virtualizer.measure(), [sidebarStyle, virtualizer]);

  // ↑/↓ moves through visible sessions, like a native source list; ⌘⌫ deletes the selected one.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Backspace' && event.metaKey) {
      const selected = rows.find((r) => r.kind === 'session' && r.data.id === selectedId);
      if (selected?.kind === 'session' && selected.data.summary) {
        event.preventDefault();
        setDeleting(selected.data);
      }
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const ids = rows.flatMap((r, index) => (r.kind === 'session' ? [{ id: r.data.id, index }] : []));
    if (ids.length === 0) return;
    const current = ids.findIndex((r) => r.id === selectedId);
    const next = ids[current === -1 ? 0 : Math.min(ids.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)))]!;
    select(next.id);
    virtualizer.scrollToIndex(next.index, { align: 'auto' });
  };

  const sessionMenu = (event: MouseEvent, data: SessionRowData) => {
    event.preventDefault();
    const at = { x: event.clientX, y: event.clientY };
    const settledNow = !isActive(data, Date.now());
    const flag = (change: { pinned?: boolean; settled?: boolean }) => void client?.call('sessions.setFlags', { sessionId: data.id, ...change });
    const cwd = data.summary?.cwd ?? data.live?.cwd ?? null;
    setMenu({
      ...at,
      entries: [
        { label: data.pinned ? 'Unpin' : 'Pin to top', onSelect: () => flag({ pinned: !data.pinned }), disabled: !data.summary },
        settledNow
          ? { label: 'Move back to the main list', onSelect: () => flag({ settled: false }), disabled: !data.summary }
          : { label: 'Settle', hint: 'until new activity', onSelect: () => flag({ settled: true, pinned: false }), disabled: !data.summary },
        { label: 'Open beside', hint: '⌥-click', onSelect: () => useSessions.getState().openBeside(data.id) },
        { label: 'Open folder in editor', onSelect: () => cwd && void openIn(cwd).catch(() => {}), disabled: !cwd },
        { label: 'Copy session ID', onSelect: () => void navigator.clipboard.writeText(data.id) },
        'separator',
        ...projectIcons.entries(data.projectRoot, at),
        'separator',
        { label: 'Delete session…', hint: '⌘⌫', danger: true, disabled: !data.summary, onSelect: () => setDeleting(data) },
      ],
    });
  };

  const liveCount = all.filter((row) => row.live !== null).length;
  const hasUpdatePill = useUpdates((s) => updatePill(s.state) !== null);

  return (
    <aside className="relative flex shrink-0 flex-col border-r border-border bg-sidebar" style={{ width }} data-sidebar>
      {/* Traffic lights on the left; the bar doubles as a window drag handle. */}
      <div className="drag flex h-13 shrink-0 items-center gap-2 pl-21">
        <img src={appIcon} alt="" width={20} height={20} draggable={false} />
        <span className="text-[13px] font-semibold text-text/90">Switchboard</span>
      </div>

      {view === 'settings' ? (
        <SettingsNav />
      ) : (
        <>
          <div className="flex items-center gap-1 px-3 pb-1.5">
            <label className="no-drag flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-muted focus-within:bg-card focus-within:ring-1 focus-within:ring-accent-ink/50 hover:bg-border/40">
              <Search size={14} className="shrink-0" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                spellCheck={false}
                className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-muted"
              />
            </label>
            <button
              type="button"
              data-new-session
              onClick={() => useSessions.getState().openNewSession()}
              data-tooltip="New session (⌘N)" aria-label="New session (⌘N)"
              className={`no-drag flex size-7 items-center justify-center rounded-md hover:bg-border/50 ${view === 'new' ? 'bg-accent/15 text-text' : 'text-muted hover:text-text'}`}
            >
              <SquarePen size={15} />
            </button>
          </div>

          <ProjectFilter counts={counts} />
          {noProjects && (
            <div className="mx-3 mb-2 grid justify-items-start gap-1 rounded-lg border border-dashed border-border px-3 py-2.5 text-[12px]" data-sidebar-onboarding>
              <p className="font-medium text-text">Add a project</p>
              <p className="text-muted">Choose the folders you work in. They are offered when you start a session.</p>
              <button type="button" onClick={() => useProjects.getState().showAdd(true)} className="mt-1 text-link hover:underline">
                Add project…
              </button>
            </div>
          )}

          <div ref={scrollRef} tabIndex={0} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 outline-none" data-session-list>
            {loaded && rows.length === 0 ? (
              <div className="grid justify-items-start gap-2 px-2 py-4 text-[12px] text-muted" data-empty-sidebar>
                <p>
                  {search
                    ? 'No sessions match your search.'
                    : projectFilter
                      ? 'No sessions in this project yet.'
                      : scope === 'switchboard'
                        ? 'Sessions you start or continue in Switchboard show up here.'
                        : 'No Claude Code sessions found yet.'}
                </p>
                {scope === 'switchboard' && sessions.size > 0 && (
                  <button type="button" onClick={() => updatePrefs({ sessionScope: 'all' })} className="text-link hover:underline">
                    Show sessions from other apps
                  </button>
                )}
              </div>
            ) : (
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((item) => {
                  const row = rows[item.index]!;
                  return (
                    <div key={item.key} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: item.size, transform: `translateY(${item.start}px)` }}>
                      {row.kind === 'session' ? (
                        <SessionRow
                          data={row.data}
                          settled={row.settled}
                          selected={view === 'session' && row.data.id === selectedId}
                          beside={view === 'session' && splitId !== null && row.data.id !== selectedId && (row.data.id === mainId || row.data.id === splitId)}
                          now={now}
                          onContextMenu={sessionMenu}
                        />
                      ) : (
                        <button
                          type="button"
                          data-settled-toggle
                          data-open={row.open}
                          onClick={toggleSettled}
                          className="mt-1 flex h-[30px] w-full items-center gap-1.5 rounded-md px-2.5 text-[12px] text-faint hover:text-muted"
                        >
                          Settled ({row.count})
                          <ChevronRight size={13} className={`transition-transform ${row.open ? 'rotate-90' : ''}`} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <footer className="flex h-10 shrink-0 items-center gap-2 border-t border-border px-3 text-[11px] text-faint">
        {/* An update to act on takes the footer's place; the session count is the lesser news. */}
        {hasUpdatePill ? (
          <div className="flex min-w-0 flex-1">
            <UpdatePillButton />
          </div>
        ) : (
          <span className="min-w-0 flex-1 truncate">
            {all.length} sessions{liveCount > 0 && ` · ${liveCount} open`}
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
          <FolderCog size={15} />
        </button>
        <button
          type="button"
          data-open-settings
          onClick={() => (view === 'settings' ? setView('session') : useSessions.getState().openSettings())}
          data-tooltip="Settings (⌘,)" aria-label="Settings (⌘,)"
          className={`flex size-7 items-center justify-center rounded-md hover:bg-border/60 hover:text-text ${view === 'settings' ? 'bg-border/60 text-text' : 'text-muted'}`}
        >
          <Settings size={15} />
        </button>
      </footer>

      {menu && <Menu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.title.length > 60 ? `${deleting.title.slice(0, 59)}…` : deleting.title}”?`}
          danger
          confirmLabel="Move to Trash"
          blockedReason={
            deleting.live && !isActiveHost(hosts.get(deleting.id))
              ? 'This session is open in another Claude Code window. Close it there first.'
              : null
          }
          body={
            <>
              The conversation and any subagent transcripts move to the Trash, so you can restore them from Finder. Files Claude changed in your
              project are not touched.
              {isActiveHost(hosts.get(deleting.id)) && ' It is running in Switchboard and will be stopped first.'}
            </>
          }
          onConfirm={async () => {
            if (!client) throw new Error('Not connected to the engine');
            // Keep the cursor in the list: select the next session (or the previous one at the end).
            const ids = rows.flatMap((r) => (r.kind === 'session' ? [r.data.id] : []));
            const index = ids.indexOf(deleting.id);
            await client.call('session.delete', { sessionId: deleting.id });
            const panes = useSessions.getState();
            if (panes.splitId && (deleting.id === panes.mainId || deleting.id === panes.splitId)) {
              // Two panes: the other one takes the full width.
              panes.closePane(deleting.id === panes.mainId ? 'main' : 'split');
            } else if (selectedId === deleting.id) {
              const next = ids[index + 1] ?? ids[index - 1] ?? null;
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
