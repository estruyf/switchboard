import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { shortAge } from '../../lib/format.ts';
import { toRows, useSessions, type SessionRowData } from '../../state/sessionsStore.ts';
import { buildSidebarRows, type SidebarRow } from '../../state/sidebarRows.ts';
import { StatusDot } from '../StatusDot.tsx';

const ROW_HEIGHT: Record<SidebarRow['kind'], number> = { project: 30, session: 30, more: 26 };

/** Re-renders relative ages once a minute without touching the store. */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const SessionRow = memo(function SessionRow({ data, selected, now }: { data: SessionRowData; selected: boolean; now: number }) {
  const select = useSessions((s) => s.select);
  const tooltip = [data.title, data.branch && `Branch: ${data.branch}`, data.summary?.cwd].filter(Boolean).join('\n');
  return (
    <button
      type="button"
      data-session-id={data.id}
      onClick={() => select(data.id)}
      title={tooltip}
      className={`flex h-[28px] w-full items-center gap-2 rounded-md pr-2 pl-6 text-left ${
        selected ? 'bg-accent/15 text-text' : 'text-text/85 hover:bg-border/50'
      }`}
    >
      <StatusDot live={data.live} />
      <span className="min-w-0 flex-1 truncate">{data.title}</span>
      {data.isWorktree && (
        <span className="shrink-0 rounded bg-border/70 px-1 text-[10px] text-muted" title={`Worktree branch ${data.branch ?? ''}`}>
          wt
        </span>
      )}
      <span className="shrink-0 text-[11px] text-faint tabular-nums">{shortAge(data.updatedAt, now)}</span>
    </button>
  );
});

function ProjectRow({ row }: { row: Extract<SidebarRow, { kind: 'project' }> }) {
  const toggle = useSessions((s) => s.toggleCollapsed);
  return (
    <button
      type="button"
      onClick={() => toggle(row.root)}
      title={row.root}
      className="flex h-[28px] w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[12px] text-muted hover:bg-border/40"
    >
      <span className={`inline-block w-3 text-[9px] text-faint transition-transform ${row.collapsed ? '' : 'rotate-90'}`}>▶</span>
      <span className="min-w-0 flex-1 truncate font-medium text-text/90">{row.name}</span>
      {row.liveStatus && (
        <span
          className={`size-1.5 rounded-full ${row.liveStatus === 'needs-you' ? 'bg-warn' : row.liveStatus === 'running' ? 'bg-accent' : 'bg-ok'}`}
          title={`${row.liveCount} open`}
        />
      )}
      <span className="text-[11px] text-faint tabular-nums">{row.count}</span>
    </button>
  );
}

function MoreRow({ row }: { row: Extract<SidebarRow, { kind: 'more' }> }) {
  const toggle = useSessions((s) => s.toggleExpanded);
  return (
    <button type="button" onClick={() => toggle(row.root)} className="h-[24px] w-full rounded-md pl-6 text-left text-[11px] text-faint hover:text-muted">
      {row.expanded ? 'Show fewer' : `Show ${row.hidden} more`}
    </button>
  );
}

export function Sidebar() {
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const filter = useSessions((s) => s.filter);
  const collapsed = useSessions((s) => s.collapsed);
  const expanded = useSessions((s) => s.expanded);
  const selectedId = useSessions((s) => s.selectedId);
  const complete = useSessions((s) => s.complete);
  const loaded = useSessions((s) => s.loaded);
  const view = useSessions((s) => s.view);
  const { setFilter, select, setView } = useSessions.getState();
  const now = useNow();

  const all = useMemo(() => toRows(sessions, live), [sessions, live]);
  const rows = useMemo(
    () => buildSidebarRows(all, { filter, collapsed, expanded, selectedId }),
    [all, filter, collapsed, expanded, selectedId],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => ROW_HEIGHT[rows[i]!.kind],
    overscan: 12,
  });

  // ↑/↓ moves through visible sessions, like a native source list.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const ids = rows.flatMap((r, index) => (r.kind === 'session' ? [{ id: r.data.id, index }] : []));
    if (ids.length === 0) return;
    const current = ids.findIndex((r) => r.id === selectedId);
    const nextIndex = current === -1 ? 0 : Math.min(ids.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)));
    const next = ids[nextIndex]!;
    select(next.id);
    virtualizer.scrollToIndex(next.index, { align: 'auto' });
  };

  const liveCount = live.size;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Leaves room for the macOS traffic lights and doubles as a window drag handle. */}
      <div className="drag h-13 shrink-0" />

      <div className="flex gap-2 px-3 pb-2">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter sessions"
          spellCheck={false}
          className="no-drag h-7 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-[12px] text-text outline-none placeholder:text-faint focus:border-accent/60"
        />
        <button
          type="button"
          disabled
          title="New session (⌘N) arrives in Phase 3"
          className="no-drag h-7 rounded-md border border-border bg-card px-2 text-[12px] text-faint"
        >
          New
        </button>
      </div>

      <div ref={scrollRef} tabIndex={0} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto px-2 outline-none">
        {loaded && rows.length === 0 ? (
          <p className="px-2 py-4 text-[12px] text-muted">{filter ? 'No sessions match this filter.' : 'No Claude Code sessions found yet.'}</p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              return (
                <div key={item.key} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: item.size, transform: `translateY(${item.start}px)` }}>
                  {row.kind === 'project' ? (
                    <ProjectRow row={row} />
                  ) : row.kind === 'session' ? (
                    <SessionRow data={row.data} selected={row.data.id === selectedId} now={now} />
                  ) : (
                    <MoreRow row={row} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <footer className="flex h-9 shrink-0 items-center justify-between border-t border-border px-3 text-[11px] text-faint">
        <span>
          {sessions.size} sessions{liveCount > 0 && ` · ${liveCount} open`}
          {!complete && loaded && ' · scanning…'}
        </span>
        <button
          type="button"
          onClick={() => setView(view === 'diagnostics' ? 'session' : 'diagnostics')}
          className={`rounded px-1.5 py-0.5 hover:bg-border/60 hover:text-muted ${view === 'diagnostics' ? 'text-text' : ''}`}
        >
          Diagnostics
        </button>
      </footer>
    </aside>
  );
}
