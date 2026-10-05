import { useVirtualizer } from '@tanstack/react-virtual';
import { SquareTerminal } from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ImageAttachment, SlashCommand } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { guessHome, shortAge, tildify } from '../../lib/format.ts';
import { nextMode } from '../../lib/modes.ts';
import { hostAsLive, isActiveHost, useHosts } from '../../state/hostsStore.ts';
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
import { liveLabel, StatusDot } from '../StatusDot.tsx';
import { buildDisplayItems } from './displayItems.ts';
import { parseTodos, TodoList } from './TodoList.tsx';
import { TranscriptItem } from './TranscriptItem.tsx';
import { useTranscript } from './useTranscript.ts';

const ORIGIN_LABEL = { cli: 'Terminal', desktop: 'Claude desktop', ide: 'IDE', sdk: 'SDK', app: 'Switchboard', unknown: '' } as const;

/** What Claude is writing right now, before the block lands in the transcript. */
function StreamingBlock({ sessionId }: { sessionId: string }) {
  const block = useHosts((s) => s.streaming.get(sessionId));
  const running = useHosts((s) => s.hosts.get(sessionId)?.state === 'running');
  if (!block && !running) return null;
  return (
    <div className="mx-auto max-w-3xl px-6 pt-3 pb-2" data-streaming>
      {block?.kind === 'text' ? (
        <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap select-text">
          {block.text}
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-accent align-middle" />
        </p>
      ) : (
        <p className="flex items-center gap-2 text-[12px] text-faint">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" />
          {block?.kind === 'tool' ? `Using ${block.text}…` : block?.kind === 'thinking' ? 'Thinking…' : 'Working…'}
          {block?.kind === 'thinking' && <span className="min-w-0 truncate italic">{block.text.slice(-160)}</span>}
        </p>
      )}
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

  useEffect(() => {
    if (!client) return;
    void client.call('session.commands', { sessionId, ...(cwd ? { cwd } : {}) }).then((r) => setCommands(r.commands));
  }, [client, sessionId, cwd, activeHost?.state === 'idle']);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 6,
    getItemKey: (i) => items[i]!.key,
  });

  // Start at the bottom, and keep following new output while the user is at the bottom.
  const stickToBottom = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  };
  const streamingText = useHosts((s) => s.streaming.get(sessionId)?.text.length ?? 0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current && items.length > 0) {
      virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
      requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
    }
  }, [items.length, streamingText, permissions.length, virtualizer]);

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
          <div className="relative mx-auto max-w-3xl px-6" style={{ height: virtualizer.getTotalSize() + 16 }}>
            {virtualizer.getVirtualItems().map((row) => (
              <div
                key={row.key}
                data-index={row.index}
                data-transcript-item
                data-item-kind={items[row.index]!.kind}
                ref={virtualizer.measureElement}
                className="absolute inset-x-6 pt-3"
                style={{ transform: `translateY(${row.start + 16}px)` }}
              >
                <TranscriptItem item={items[row.index]!} cwd={cwd} sessionId={sessionId} />
              </div>
            ))}
          </div>
        )}
        <StreamingBlock sessionId={sessionId} />
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
