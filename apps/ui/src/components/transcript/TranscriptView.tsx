import { useVirtualizer } from '@tanstack/react-virtual';
import { SquareTerminal } from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ImageAttachment, SlashCommand } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { guessHome, shortAge, tildify } from '../../lib/format.ts';
import { nextMode } from '../../lib/modes.ts';
import { hostAsLive, isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { realBranch, useSessions } from '../../state/sessionsStore.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
// xterm.js is large; it loads the first time a terminal panel opens, not at startup.
const TerminalPanel = lazy(() => import('../terminal/TerminalPanel.tsx').then((m) => ({ default: m.TerminalPanel })));
import { Composer } from '../composer/Composer.tsx';
import { ActionsBar } from '../actions/ActionsBar.tsx';
import { OpenInButton } from '../OpenInButton.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { PermissionCard } from '../session/PermissionCard.tsx';
import { StatusBar } from '../session/StatusBar.tsx';
import { UsageBand } from '../UsageBand.tsx';
import { liveLabel, StatusDot } from '../StatusDot.tsx';
import { formatDuration, useTicker, WorkingDots } from './ActivityGroup.tsx';
import { buildDisplayItems, groupActivity, type RenderItem } from './displayItems.ts';
import { parseTodos, TodoList } from './TodoList.tsx';
import { TranscriptItem } from './TranscriptItem.tsx';
import { useTranscript } from './useTranscript.ts';

const ORIGIN_LABEL = { cli: 'Terminal', desktop: 'Claude desktop', ide: 'IDE', sdk: 'SDK', app: 'Switchboard', unknown: '' } as const;

/**
 * What Claude is doing right now, before it lands in the transcript: the text it's writing,
 * or (when no step line is already showing it) dots, the time since your message, and the step.
 */
function StreamingBlock({ sessionId, since, showIndicator }: { sessionId: string; since: number | null; showIndicator: boolean }) {
  const block = useHosts((s) => s.streaming.get(sessionId));
  const running = useHosts((s) => s.hosts.get(sessionId)?.state === 'running');
  const now = useTicker(running && showIndicator && block?.kind !== 'text');
  if (block?.kind === 'text') {
    return (
      <div className="mx-auto max-w-3xl px-6 pt-3 pb-2" data-streaming>
        <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap select-text">
          {block.text}
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-accent-ink align-middle" />
        </p>
      </div>
    );
  }
  if (!running || !showIndicator) return null;
  const label = block?.kind === 'tool' ? `Using ${block.text}` : block?.kind === 'thinking' ? 'Thinking' : 'Working';
  return (
    <div className="mx-auto max-w-3xl px-6 pt-3 pb-2" data-streaming>
      <p className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted">
        <span className="flex w-4 shrink-0 justify-center">
          <WorkingDots />
        </span>
        {since !== null && <span className="shrink-0 text-faint tabular-nums">{formatDuration(now - since)} ·</span>}
        <span className="shrink-0">{label}</span>
        {block?.kind === 'thinking' && block.text && <span className="min-w-0 truncate text-faint italic">{block.text.slice(-160)}</span>}
      </p>
    </div>
  );
}

/** A session: live transcript, plus composer and controls when it can run here. */
export function TranscriptView({ sessionId }: { sessionId: string }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const summary = useSessions((s) => s.sessions.get(sessionId) ?? null);
  const registryLive = useSessions((s) => s.live.get(sessionId) ?? null);
  const select = useSessions((s) => s.select);
  const host = useHosts((s) => s.hosts.get(sessionId));
  const permissionMap = useHosts((s) => s.permissions);
  const permissions = useMemo(() => [...permissionMap.values()].filter((p) => p.sessionId === sessionId), [permissionMap, sessionId]);
  const home = useSessions((s) => guessHome([...s.sessions.values()].slice(0, 20).flatMap((x) => (x.cwd ? [x.cwd] : []))));
  const { status, messages } = useTranscript(sessionId);
  const panelOpen = useTerminals((s) => s.panelOpen);
  const togglePanel = useTerminals((s) => s.togglePanel);
  const terminalCount = useTerminals((s) => [...s.terminals.values()].filter((t) => t.sessionId === sessionId && t.exitCode === null).length);

  // Setup and project actions open their own terminal tab: show it as soon as one starts.
  const actionTerminals = useTerminals((s) => [...s.terminals.values()].filter((t) => t.sessionId === sessionId && t.kind === 'action').map((t) => t.id).join(','));
  const seenActionTerminals = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = actionTerminals ? actionTerminals.split(',') : [];
    if (seenActionTerminals.current === null) {
      seenActionTerminals.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !seenActionTerminals.current!.has(id));
    ids.forEach((id) => seenActionTerminals.current!.add(id));
    if (fresh.length) {
      useTerminals.getState().togglePanel(true);
      useTerminals.getState().setActive(sessionId, fresh.at(-1)!);
    }
  }, [actionTerminals, sessionId]);
  const items = useMemo(() => buildDisplayItems(messages), [messages]);
  const toolActivity = usePreferences((s) => s.prefs.toolActivity);
  const renderItems = useMemo<RenderItem[]>(() => (toolActivity === 'summary' ? groupActivity(items) : items), [items, toolActivity]);
  const [commands, setCommands] = useState<SlashCommand[]>([]);

  const projectRoot = summary?.projectRoot ?? registryLive?.projectRoot ?? null;
  const project = useProjects((s) => (projectRoot ? s.projects.get(projectRoot) : undefined));

  // Looking at a session marks it read, also while new output keeps arriving.
  const unread = summary?.unread ?? false;
  useEffect(() => {
    if (!client || !unread) return;
    const timer = setTimeout(() => void client.call('sessions.markViewed', { sessionId }).catch(() => {}), 600);
    return () => clearTimeout(timer);
  }, [client, sessionId, unread, summary?.updatedAt]);

  // The latest task list, pinned above the composer while there's still work on it.
  const todos = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!;
      if (item.kind === 'tool' && item.name === 'TodoWrite') return parseTodos(item.input);
    }
    return [];
  }, [items]);
  const [todosOpen, setTodosOpen] = useState(true);

  const activeHost = isActiveHost(host) ? host : null;
  const live = activeHost ? hostAsLive(activeHost) : registryLive;
  const openElsewhere = !activeHost && registryLive !== null;
  const cwd = activeHost?.cwd ?? summary?.cwd ?? registryLive?.cwd ?? null;
  const running = activeHost?.state === 'running' || activeHost?.state === 'needs-you';

  // The run of steps Claude is on now (summary mode), and what to call it between steps.
  const lastRender = renderItems.at(-1);
  // Sessions running elsewhere (a terminal, Claude desktop) count too: their status comes from the registry.
  const working = running || live?.status === 'running' || live?.status === 'needs-you';
  const activeGroupKey = working && lastRender?.kind === 'activity' ? lastRender.key : null;
  const streamKind = useHosts((s) => s.streaming.get(sessionId)?.kind ?? null);
  const streamTool = useHosts((s) => (s.streaming.get(sessionId)?.kind === 'tool' ? s.streaming.get(sessionId)!.text : null));
  const activeLabel =
    live?.status === 'needs-you' ? 'Waiting for you' : streamKind === 'thinking' ? 'Thinking' : streamKind === 'tool' && streamTool ? `Using ${streamTool}` : null;
  // When your last message went in, for the "9s · Thinking" timer.
  const turnStart = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!;
      if ((item.kind === 'user' && !item.subagent) || item.kind === 'command') return item.at;
    }
    return null;
  }, [items]);

  useEffect(() => {
    if (!client) return;
    void client.call('session.commands', { sessionId, ...(cwd ? { cwd } : {}) }).then((r) => setCommands(r.commands));
  }, [client, sessionId, cwd, activeHost?.state === 'idle']);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: renderItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 6,
    getItemKey: (i) => renderItems[i]!.key,
    // Room above the first message and between the last one and the composer.
    paddingStart: 16,
    paddingEnd: 28,
    scrollPaddingEnd: 28,
  });

  // Start at the bottom, and keep following new output while the user is at the bottom.
  // Only scrolling up stops the following: the automatic scrolling below only moves down, and
  // while rows are measured it can briefly sit far from the end, which must not count as leaving.
  const stickToBottom = useRef(true);
  const lastScrollTop = useRef(0);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (el.scrollTop < lastScrollTop.current - 1) stickToBottom.current = nearEnd;
    else if (nearEnd) stickToBottom.current = true;
    lastScrollTop.current = el.scrollTop;
  };
  const streamingText = useHosts((s) => s.streaming.get(sessionId)?.text.length ?? 0);
  // Rows start at an estimated height and grow once measured, so follow the total size too:
  // otherwise the first jump lands short of the end and the last message sits under the composer.
  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current && renderItems.length > 0) {
      virtualizer.scrollToIndex(renderItems.length - 1, { align: 'end' });
      requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
    }
  }, [renderItems.length, totalSize, streamingText, permissions.length, virtualizer]);

  const send = async (text: string, attachments: ImageAttachment[], fork = false) => {
    if (!client) throw new Error('Not connected to the engine');
    stickToBottom.current = true;
    const result = await client.call('session.send', { sessionId, text, attachments, fork });
    if (result.sessionId !== sessionId) select(result.sessionId);
  };

  const branch = summary?.worktree?.branch ?? realBranch(summary?.gitBranch ?? null);
  const origin = summary ? ORIGIN_LABEL[summary.origin] : activeHost ? ORIGIN_LABEL.app : registryLive ? ORIGIN_LABEL[registryLive.origin] : '';
  const meta = [
    cwd && tildify(cwd, home),
    branch && (summary?.worktree ? `worktree · ${branch}` : branch),
    origin,
    summary && (shortAge(summary.updatedAt) === 'now' ? 'updated just now' : `updated ${shortAge(summary.updatedAt)} ago`),
  ].filter(Boolean);

  return (
    <div className="flex h-full min-h-0 flex-col" data-current-session={sessionId}>
      <header className="drag flex h-13 shrink-0 items-center gap-3 border-b border-border px-6">
        {projectRoot && <ProjectIcon project={project} root={projectRoot} size={22} />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[13px] font-semibold">{summary?.title ?? registryLive?.name ?? 'New session'}</h1>
          <p className="truncate text-[11px] text-faint">{meta.join('  ·  ')}</p>
        </div>
        {live && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
            <StatusDot live={live} />
            {liveLabel(live)}
          </span>
        )}
        <ActionsBar sessionId={sessionId} projectRoot={projectRoot} cwd={cwd} />
        <button
          type="button"
          data-toggle-terminal
          onClick={() => togglePanel()}
          title="Terminal (⌘J)"
          className={`no-drag relative flex size-7 shrink-0 items-center justify-center rounded-md border border-border hover:bg-border/50 ${panelOpen ? 'bg-accent/15 text-text' : 'text-muted'}`}
        >
          <SquareTerminal size={14} />
          {terminalCount > 0 && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-ok" title={`${terminalCount} running`} />}
        </button>
        <OpenInButton path={cwd} />
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto" data-transcript>
        {status === 'loading' ? (
          <p className="p-8 text-center text-[12px] text-faint">Loading transcript…</p>
        ) : items.length === 0 && !activeHost ? (
          <p className="p-8 text-center text-[12px] text-faint">This session has no messages yet.</p>
        ) : (
          <div className="relative mx-auto max-w-3xl px-6" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => (
              <div
                key={row.key}
                data-index={row.index}
                data-transcript-item
                data-item-kind={renderItems[row.index]!.kind}
                ref={virtualizer.measureElement}
                className="absolute inset-x-6 pt-3"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <TranscriptItem
                  item={renderItems[row.index]!}
                  cwd={cwd}
                  sessionId={sessionId}
                  active={renderItems[row.index]!.key === activeGroupKey}
                  activeLabel={renderItems[row.index]!.key === activeGroupKey ? activeLabel : null}
                />
              </div>
            ))}
          </div>
        )}
        <StreamingBlock sessionId={sessionId} since={turnStart} showIndicator={activeGroupKey === null} />
      </div>

      <div className="shrink-0 border-t border-border bg-bg">
        <div className="mx-auto grid max-w-3xl gap-2 px-6 pt-3 pb-1.5">
          {todos.some((t) => t.status !== 'completed') && (live || activeHost) && (
            <div className="rounded-lg border border-border bg-card px-3 py-2" data-todo-strip>
              <button type="button" onClick={() => setTodosOpen((o) => !o)} className="flex w-full items-center gap-2 text-left text-[11px] text-muted">
                <span className={`inline-block text-[8px] transition-transform ${todosOpen ? 'rotate-90' : ''}`}>▶</span>
                Tasks · {todos.filter((t) => t.status === 'completed').length}/{todos.length} done
              </button>
              {todosOpen && (
                <div className="mt-1.5 max-h-40 overflow-y-auto">
                  <TodoList todos={todos} compact />
                </div>
              )}
            </div>
          )}
          {permissions.map((request) => (
            <PermissionCard key={request.requestId} request={request} cwd={cwd} />
          ))}
          {openElsewhere && (
            <p className="rounded-lg border border-border bg-card px-3 py-2 text-[12px] text-muted">
              This session is open in {ORIGIN_LABEL[registryLive.origin] || 'another Claude Code window'} right now. Sending here starts a{' '}
              <strong className="font-medium text-text">fork</strong>: a new session that continues from this conversation, leaving the original untouched.
            </p>
          )}
          <UsageBand />
          <Composer
            cwd={cwd}
            commands={commands}
            running={running}
            placeholder={activeHost ? 'Message Claude' : 'Message Claude to resume this session'}
            submitLabel={openElsewhere ? 'Fork and send' : undefined}
            disabledReason={!client ? 'Connecting to the engine…' : !cwd ? 'The folder for this session is unknown' : null}
            onSubmit={(text, attachments) => send(text, attachments, openElsewhere)}
            onInterrupt={() => void client?.call('session.interrupt', { sessionId })}
            onCycleMode={
              activeHost ? () => void client?.call('session.setPermissionMode', { sessionId, mode: nextMode(activeHost.permissionMode) }) : undefined
            }
          />
          {activeHost ? (
            <StatusBar host={activeHost} />
          ) : (
            <p className="flex h-7 items-center px-1 text-[11px] text-faint">
              {host?.state === 'error' ? <span className="text-error">Last run failed: {host.error}</span> : 'Not running in Switchboard. Sending a message resumes it here.'}
            </p>
          )}
        </div>
      </div>
      {panelOpen && (
        <Suspense fallback={<div className="h-40 shrink-0 border-t border-border bg-sidebar" />}>
          <TerminalPanel sessionId={sessionId} cwd={cwd} />
        </Suspense>
      )}
    </div>
  );
}
