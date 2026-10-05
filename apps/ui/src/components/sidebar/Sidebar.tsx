import { useVirtualizer } from '@tanstack/react-virtual';
import { Activity, ChevronRight, GitBranch, Pin, Search, SquarePen } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { shortAge } from '../../lib/format.ts';
import { isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions, type SessionRowData } from '../../state/sessionsStore.ts';
import { buildSessionList, isActive, rowStatus } from '../../state/sidebarRows.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { ProjectFilter, useProjectIconEntries } from './ProjectMenu.tsx';
import { StatusIcon } from './StatusIcon.tsx';

type ListRow = { kind: 'session'; data: SessionRowData; settled: boolean } | { kind: 'settled-header'; count: number; open: boolean };

const ROW_HEIGHT = { session: 70, 'settled-header': 34 } as const;

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
  settled,
  now,
  onContextMenu,
}: {
  data: SessionRowData;
  selected: boolean;
  settled: boolean;
  now: number;
  onContextMenu(event: MouseEvent, data: SessionRowData): void;
}) {
  const select = useSessions((s) => s.select);
  const project = useProjects((s) => s.projects.get(data.projectRoot));
  const status = rowStatus(data);
  const emphasised = status !== null && status !== 'idle';
  const ageTone = status === 'needs-you' ? 'text-warn' : status === 'running' || status === 'unread' ? 'text-accent' : 'text-faint';
  return (
    <button
      type="button"
      data-session-id={data.id}
      onClick={() => select(data.id)}
      onContextMenu={(e) => onContextMenu(e, data)}
      title={[data.title, data.summary?.cwd].filter(Boolean).join('\n')}
      className={`grid h-[66px] w-full grid-rows-3 rounded-lg px-2.5 py-1.5 text-left ${selected ? 'bg-accent/15' : 'hover:bg-border/45'}`}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
        <ProjectIcon project={project} root={data.projectRoot} size={13} />
        <span className="min-w-0 flex-1 truncate">{project?.name ?? data.projectRoot.split('/').pop()}</span>
        {data.pinned && <Pin size={11} className="shrink-0 text-faint" aria-label="Pinned" />}
        <span className={`shrink-0 tabular-nums ${ageTone}`}>{shortAge(data.updatedAt, now)}</span>
      </span>
      <span className={`min-w-0 truncate text-[13px] leading-5 ${emphasised || selected ? 'font-semibold text-text' : settled ? 'text-muted' : 'text-text/80'}`}>
        {data.title}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-faint">
        {data.branch && (
          <>
            <GitBranch size={11} className={`shrink-0 ${data.isWorktree ? 'text-accent/80' : ''}`} aria-label={data.isWorktree ? 'Worktree' : 'Branch'} />
            <span className="min-w-0 truncate">{data.branch}</span>
          </>
        )}
        <span className="flex-1" />
        <StatusIcon status={status} />
      </span>
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
  const complete = useSessions((s) => s.complete);
  const loaded = useSessions((s) => s.loaded);
  const view = useSessions((s) => s.view);
  const { setFilter: setSearch, select, setView } = useSessions.getState();
  const projectFilter = useProjects((s) => s.filter);
  const settledOpen = useProjects((s) => s.settledOpen);
  const toggleSettled = useProjects((s) => s.toggleSettled);
  const openIn = useOpenIn();
  const projectIcons = useProjectIconEntries();
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [deleting, setDeleting] = useState<SessionRowData | null>(null);
  const now = useNow();

  const all = useMemo(() => toRows(sessions, live, hosts), [sessions, live, hosts]);
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
    estimateSize: (i) => ROW_HEIGHT[rows[i]!.kind],
    overscan: 10,
  });

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
        { label: 'Open folder in editor', onSelect: () => cwd && void openIn(cwd).catch(() => {}), disabled: !cwd },
        { label: 'Copy session ID', onSelect: () => void navigator.clipboard.writeText(data.id) },
        'separator',
        ...projectIcons.entries(data.projectRoot, at),
        'separator',
        { label: 'Delete session…', hint: '⌘⌫', danger: true, disabled: !data.summary, onSelect: () => setDeleting(data) },
      ],
    });
  };

  const liveCount = new Set([...live.keys(), ...[...hosts.values()].filter((h) => h.state !== 'closed' && h.state !== 'error').map((h) => h.sessionId)]).size;

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Traffic lights on the left; the bar doubles as a window drag handle. */}
      <div className="drag flex h-13 shrink-0 items-center pl-21">
        <span className="text-[13px] font-semibold text-text/90">Switchboard</span>
      </div>

      <div className="flex items-center gap-1 px-3 pb-1.5">
        <label className="no-drag flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-muted focus-within:bg-card focus-within:ring-1 focus-within:ring-accent/50 hover:bg-border/40">
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
          onClick={() => setView('new')}
          title="New session (⌘N)"
          className={`no-drag flex size-7 items-center justify-center rounded-md hover:bg-border/50 ${view === 'new' ? 'bg-accent/15 text-text' : 'text-muted hover:text-text'}`}
        >
          <SquarePen size={15} />
        </button>
      </div>

      <ProjectFilter counts={counts} />

      <div ref={scrollRef} tabIndex={0} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 outline-none">
        {loaded && rows.length === 0 ? (
          <p className="px-2 py-4 text-[12px] text-muted">
            {search ? 'No sessions match your search.' : projectFilter ? 'No sessions in this project yet.' : 'No Claude Code sessions found yet.'}
          </p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              return (
                <div key={item.key} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: item.size, transform: `translateY(${item.start}px)` }}>
                  {row.kind === 'session' ? (
                    <SessionRow data={row.data} settled={row.settled} selected={view === 'session' && row.data.id === selectedId} now={now} onContextMenu={sessionMenu} />
                  ) : (
                    <button
                      type="button"
                      data-settled-toggle
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

      <footer className="flex h-10 shrink-0 items-center gap-2 border-t border-border px-3 text-[11px] text-faint">
        <span className="min-w-0 flex-1 truncate">
          {sessions.size} sessions{liveCount > 0 && ` · ${liveCount} open`}
          {waiting > 0 && <span className="text-warn">{` · ${waiting} waiting`}</span>}
          {!complete && loaded && ' · scanning…'}
        </span>
        <button
          type="button"
          onClick={() => setView(view === 'diagnostics' ? 'session' : 'diagnostics')}
          title="Diagnostics"
          className={`flex size-7 items-center justify-center rounded-md hover:bg-border/60 hover:text-muted ${view === 'diagnostics' ? 'text-text' : ''}`}
        >
          <Activity size={14} />
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
            if (selectedId === deleting.id) {
              const next = ids[index + 1] ?? ids[index - 1] ?? null;
              if (next) select(next);
              else setView('session');
            }
          }}
          onClose={() => setDeleting(null)}
        />
      )}
      {projectIcons.picker}
    </aside>
  );
}
