import { useVirtualizer } from '@tanstack/react-virtual';
import { Blocks, FileDiff, SquareTerminal, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangesBase, GitChanges, ImageAttachment, RewindResult, SlashCommand } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { guessHome, shortAge, tildify } from '../../lib/format.ts';
import { nextMode } from '../../lib/modes.ts';
import { hostAsLive, isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { realBranch, useSessions, type Pane } from '../../state/sessionsStore.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
// xterm.js is large; it loads the first time a terminal panel opens, not at startup.
const TerminalPanel = lazy(() => import('../terminal/TerminalPanel.tsx').then((m) => ({ default: m.TerminalPanel })));
import { Composer } from '../composer/Composer.tsx';
import { CapabilitiesDialog } from '../capabilities/CapabilitiesDialog.tsx';
import { ChangesPanel } from '../changes/ChangesPanel.tsx';
import { ContextMeter } from '../session/ContextMeter.tsx';
import { WorktreeMenu } from '../worktree/WorktreeMenu.tsx';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { ActionsBar } from '../actions/ActionsBar.tsx';
import { OpenInButton } from '../OpenInButton.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { PermissionCard } from '../session/PermissionCard.tsx';
import { StatusBar } from '../session/StatusBar.tsx';
import { ProfileBadge } from '../profiles/ProfileBadge.tsx';
import { UsageBand } from '../UsageBand.tsx';
import { liveLabel, StatusDot } from '../StatusDot.tsx';
import { formatDuration, useTicker, WorkingDots } from './ActivityGroup.tsx';
import { AgentsButton } from './AgentsButton.tsx';
import { buildDisplayItems, groupActivity, type RenderItem } from './displayItems.ts';
import { StreamingMarkdown } from './Markdown.tsx';
import { MessageActionsContext, messageUuid, pendingDrafts, type MessageActions } from './messageActions.tsx';
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
        <StreamingMarkdown text={block.text} />
        <span className="mt-0.5 block h-3.5 w-1.5 animate-pulse bg-accent-ink" />
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

/**
 * The checkout's git changes, refreshed when the session does something (debounced),
 * when the window comes back into focus, and on request. `isRepo` is false outside git.
 */
function useGitChanges(cwd: string | null, base: ChangesBase, activity: string) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [isRepo, setIsRepo] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!client || !cwd) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      client.call('git.changes', { cwd, base }).then(
        (result) => !cancelled && (setChanges(result), setIsRepo(true)),
        () => !cancelled && (setChanges(null), setIsRepo(false)),
      );
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, cwd, base, activity, version]);
  useEffect(() => {
    const onFocus = () => setVersion((v) => v + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  return { changes, isRepo, refresh: () => setVersion((v) => v + 1) };
}

/** A session: live transcript, plus composer and controls when it can run here. */
export function TranscriptView({ sessionId, pane = null, active = true }: { sessionId: string; pane?: Pane | null; active?: boolean }) {
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
  /** The Claude profile (account) the session bills to. */
  const profileId = activeHost?.profileId ?? summary?.profileId ?? registryLive?.profileId ?? null;

  // The Changes panel (⌘⇧D): the checkout's git diff, with stage and revert.
  const changesOpen = useOverlay((s) => s.changesOpen);
  // With two panes, panels and dialogs belong to the active one.
  const toolsOpen = useOverlay((s) => s.open === 'tools') && active;
  const toggleChanges = useOverlay((s) => s.toggleChanges);
  const [changesBase, setChangesBase] = useState<ChangesBase>('uncommitted');
  const { changes, isRepo, refresh: refreshChanges } = useGitChanges(cwd, changesBase, `${items.length}:${live?.status ?? ''}`);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (active && event.metaKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        toggleChanges();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
  // Following the end stops only when *you* scroll away (wheel, trackpad, keys, scrollbar): the
  // list also moves itself while rows are measured, and that must never count as leaving.
  // Getting back near the end, by any means, follows again.
  const stickToBottom = useRef(true);
  const userScrollAt = useRef(0);
  const markUserScroll = () => (userScrollAt.current = Date.now());
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) stickToBottom.current = true;
    else if (Date.now() - userScrollAt.current < 1_000) stickToBottom.current = false;
  };
  const onScrollKey = (event: { key: string }) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) markUserScroll();
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

  // Search opened this session at a message: scroll there once it's loaded, and highlight it briefly.
  const focusMessage = useOverlay((s) => (s.focusMessage?.sessionId === sessionId ? s.focusMessage.messageUuid : null));
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  useEffect(() => {
    if (!focusMessage) return;
    const index = renderItems.findIndex((item) =>
      item.kind === 'activity' ? item.items.some((i) => messageUuid(i.key) === focusMessage) : messageUuid(item.key) === focusMessage,
    );
    if (index === -1) return;
    stickToBottom.current = false;
    virtualizer.scrollToIndex(index, { align: 'center' });
    // Rows are measured as they render; settle on the exact spot a frame later.
    requestAnimationFrame(() => virtualizer.scrollToIndex(index, { align: 'center' }));
    setHighlightKey(renderItems[index]!.key);
    useOverlay.getState().focus(null);
    const timer = setTimeout(() => setHighlightKey(null), 2_500);
    return () => clearTimeout(timer);
  }, [focusMessage, renderItems, virtualizer]);

  // Fork, edit and rewind from a message.
  const [initialText] = useState(() => {
    const draft = pendingDrafts.get(sessionId);
    pendingDrafts.delete(sessionId);
    return draft;
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [rewinding, setRewinding] = useState<{ uuid: string; preview: RewindResult | null; error: string | null } | null>(null);
  const messageActions = useMemo<MessageActions | null>(() => {
    if (!client) return null;
    // The message before each one (by uuid), for forking just before a prompt.
    const previous = new Map<string, string>();
    let last: string | null = null;
    for (const item of items) {
      const uuid = messageUuid(item.key);
      if (uuid === last) continue;
      if (last) previous.set(uuid, last);
      last = uuid;
    }
    const fail = (error: unknown) => setActionError(error instanceof Error ? error.message : String(error));
    return {
      fork: (uuid) => void client.call('session.forkAt', { sessionId, messageUuid: uuid }).then((r) => select(r.sessionId), fail),
      edit: (uuid, text) => {
        const before = previous.get(uuid);
        if (!before) return;
        void client.call('session.forkAt', { sessionId, messageUuid: before }).then((r) => {
          pendingDrafts.set(r.sessionId, text);
          select(r.sessionId);
        }, fail);
      },
      rewind: (uuid) => {
        setRewinding({ uuid, preview: null, error: null });
        client.call('session.rewind', { sessionId, messageUuid: uuid, dryRun: true }).then(
          (preview) => setRewinding((r) => (r?.uuid === uuid ? { ...r, preview } : r)),
          (error: Error) => setRewinding((r) => (r?.uuid === uuid ? { ...r, error: error.message } : r)),
        );
      },
      canEdit: (uuid) => previous.has(uuid),
    };
  }, [client, items, sessionId, select]);

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
    // `@container`: the header compacts itself when the pane is narrow (two sessions side by side).
    <div className="@container flex h-full min-h-0 flex-col" data-current-session={sessionId} data-drop-zone>
      {/* With two panes, the active one has an accent line along the top. */}
      <header
        className={`drag flex h-13 shrink-0 items-center gap-3 overflow-hidden border-b border-border px-6 @max-[860px]:gap-2 @max-[860px]:px-4 ${pane && active ? 'shadow-[inset_0_2px_0_var(--sb-accent)]' : ''} ${pane && !active ? 'opacity-75' : ''}`}
        data-pane={pane ?? undefined}
        data-pane-active={pane ? active : undefined}
      >
        {projectRoot && <ProjectIcon project={project} root={projectRoot} size={22} />}
        <div className="min-w-24 flex-1">
          <h1 className="truncate text-[13px] font-semibold">{summary?.title ?? registryLive?.name ?? 'New session'}</h1>
          <p className="truncate text-[11px] text-faint">{meta.join('  ·  ')}</p>
        </div>
        <ProfileBadge profileId={profileId} className="rounded-full border border-border px-2 py-0.5 text-[11px] @max-[860px]:hidden" />
        {live && (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted" data-session-status>
            <StatusDot live={live} />
            <span className="@max-[860px]:hidden">{liveLabel(live)}</span>
          </span>
        )}
        <AgentsButton items={items} sessionId={sessionId} cwd={cwd} sessionOpen={live !== null} />
        {cwd && (summary?.worktree || /[\\/]\.claude[\\/]worktrees[\\/]/.test(cwd)) && (
          <WorktreeMenu
            sessionId={sessionId}
            cwd={cwd}
            onCommit={() => void send('Commit the current changes with a clear, conventional commit message.', [], openElsewhere).catch((e: Error) => setActionError(e.message))}
          />
        )}
        <ActionsBar sessionId={sessionId} projectRoot={projectRoot} cwd={cwd} />
        {cwd && isRepo && (
          <button
            type="button"
            data-toggle-changes
            onClick={() => toggleChanges()}
            data-tooltip="Changes (⌘⇧D)" aria-label="Changes (⌘⇧D)"
            className={`no-drag flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-1.5 text-[11.5px] hover:bg-border/50 ${changesOpen ? 'bg-accent/15 text-text' : 'text-muted'}`}
          >
            <FileDiff size={14} />
            {changesBase === 'uncommitted' && changes && changes.files.length > 0 && <span className="tabular-nums">{changes.files.length}</span>}
          </button>
        )}
        <button
          type="button"
          data-toggle-terminal
          onClick={() => togglePanel()}
          data-tooltip="Terminal (⌘J)" aria-label="Terminal (⌘J)"
          className={`no-drag relative flex size-7 shrink-0 items-center justify-center rounded-md border border-border hover:bg-border/50 ${panelOpen ? 'bg-accent/15 text-text' : 'text-muted'}`}
        >
          <SquareTerminal size={14} />
          {terminalCount > 0 && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-ok" data-tooltip={`${terminalCount} running`} />}
        </button>
        <OpenInButton path={cwd} />
        {!pane && (
          <button
            type="button"
            data-close-session
            onClick={() => useSessions.getState().closeSession()}
            data-tooltip="Close session" aria-label="Close session"
            className="no-drag flex size-7 shrink-0 items-center justify-center rounded-md text-faint hover:bg-border/50 hover:text-text"
          >
            <X size={14} />
          </button>
        )}
        {pane && (
          <button
            type="button"
            data-close-pane
            onClick={() => useSessions.getState().closePane(pane)}
            data-tooltip="Close this pane (⌘\\ closes the other one)" aria-label="Close this pane (⌘\\ closes the other one)"
            className="no-drag flex size-7 shrink-0 items-center justify-center rounded-md text-faint hover:bg-border/50 hover:text-text"
          >
            <X size={14} />
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageActionsContext.Provider value={messageActions}>
            <div
              ref={scrollRef}
              onScroll={onScroll}
              onWheel={markUserScroll}
              onTouchMove={markUserScroll}
              onPointerDown={markUserScroll}
              onKeyDown={onScrollKey}
              className="min-h-0 flex-1 overflow-y-auto"
              data-transcript
            >
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
                      className={`absolute inset-x-6 pt-3 ${row.key === highlightKey ? 'search-highlight' : ''}`}
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
          </MessageActionsContext.Provider>

          {toolsOpen && cwd && <CapabilitiesDialog sessionId={sessionId} cwd={cwd} profileId={profileId} onClose={() => useOverlay.getState().close()} />}
      {rewinding && (
            <ConfirmDialog
              title="Undo file changes since this message?"
              danger
              confirmLabel="Undo changes"
              blockedReason={
                rewinding.error ??
                (!rewinding.preview
                  ? 'Checking what changed…'
                  : !rewinding.preview.canRewind
                    ? (rewinding.preview.error ?? 'Claude Code has no checkpoint for this message.')
                    : rewinding.preview.files.length === 0
                      ? 'Nothing to undo: no files changed after this message.'
                      : null)
              }
              body={
                <>
                  <p>Files go back to how they were before this message. The conversation stays as it is.</p>
                  {rewinding.preview && rewinding.preview.files.length > 0 && (
                    <>
                      <ul className="mt-2 max-h-40 overflow-y-auto font-mono text-[11.5px] text-text" data-rewind-files>
                        {rewinding.preview.files.map((file) => (
                          <li key={file} className="truncate">
                            {cwd && file.startsWith(`${cwd}/`) ? file.slice(cwd.length + 1) : file}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1.5 text-[11.5px]">
                        <span className="text-ok">+{rewinding.preview.insertions}</span> <span className="text-error">−{rewinding.preview.deletions}</span>
                      </p>
                    </>
                  )}
                </>
              }
              onConfirm={async () => {
                const result = await client!.call('session.rewind', { sessionId, messageUuid: rewinding.uuid, dryRun: false });
                if (!result.canRewind) throw new Error(result.error ?? 'Could not undo the changes');
              }}
              onClose={() => setRewinding(null)}
            />
          )}

          <div className="shrink-0 border-t border-border bg-bg">
            {/* minmax(0,1fr): the column stays as wide as the pane, so long lines truncate instead of pushing it wider. */}
            <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-2 px-6 pt-3 pb-1.5 @max-[860px]:px-4">
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
              {/* Long questions scroll inside here, so the window itself never scrolls. */}
              {permissions.length > 0 && (
                <div className="grid max-h-[55vh] gap-2 overflow-y-auto" data-permissions>
                  {permissions.map((request) => (
                    <PermissionCard key={request.requestId} request={request} cwd={cwd} />
                  ))}
                </div>
              )}
              {openElsewhere && (
                <p className="rounded-lg border border-border bg-card px-3 py-2 text-[12px] text-muted">
                  This session is open in {ORIGIN_LABEL[registryLive.origin] || 'another Claude Code window'} right now. Sending here starts a{' '}
                  <strong className="font-medium text-text">fork</strong>: a new session that continues from this conversation, leaving the original untouched.
                </p>
              )}
              <UsageBand profileId={profileId} />
              {actionError && (
                <p className="flex items-start gap-2 rounded-lg border border-error/40 bg-error/5 px-3 py-2 text-[12px] text-error" role="alert">
                  <span className="min-w-0 flex-1">{actionError}</span>
                  <button type="button" onClick={() => setActionError(null)} className="shrink-0 text-faint hover:text-text">
                    Dismiss
                  </button>
                </p>
              )}
              <Composer
                initialText={initialText}
                cwd={cwd}
                commands={commands}
                running={running}
                placeholder={activeHost ? 'Message Claude' : 'Message Claude to resume this session'}
                submitLabel={openElsewhere ? 'Fork and send' : undefined}
                dropHint={status === 'ready' && messages.length === 0}
                disabledReason={!client ? 'Connecting to the engine…' : !cwd ? 'The folder for this session is unknown' : null}
                onSubmit={(text, attachments) => send(text, attachments, openElsewhere)}
                onInterrupt={() => void client?.call('session.interrupt', { sessionId })}
                onCycleMode={
                  activeHost ? () => void client?.call('session.setPermissionMode', { sessionId, mode: nextMode(activeHost.permissionMode) }) : undefined
                }
              />
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  {activeHost ? (
                    <StatusBar host={activeHost} />
                  ) : (
                    <p className="flex h-7 items-center gap-2 px-1 text-[11px] text-faint">
                      <span className="min-w-0 flex-1 truncate">
                        {host?.state === 'error' ? <span className="text-error">Last run failed: {host.error}</span> : 'Not running in Switchboard. Sending a message resumes it here.'}
                      </span>
                      <ContextMeter sessionId={sessionId} live={null} messages={messages} />
                    </p>
                  )}
                </div>
                {cwd && (
                  <button
                    type="button"
                    data-open-tools
                    onClick={() => useOverlay.getState().show('tools')}
                    data-tooltip="MCP servers, skills, agents and plugins" aria-label="MCP servers, skills, agents and plugins"
                    className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-faint hover:bg-border/50 hover:text-text"
                  >
                    <Blocks size={12} />
                    <span className="@max-[860px]:hidden">Tools</span>
                  </button>
                )}
              </div>
            </div>
          </div>
          {panelOpen && active && (
            <Suspense fallback={<div className="h-40 shrink-0 border-t border-border bg-sidebar" />}>
              <TerminalPanel sessionId={sessionId} cwd={cwd} />
            </Suspense>
          )}
        </div>
        {changesOpen && active && cwd && isRepo && (
          <ChangesPanel cwd={cwd} changes={changes} base={changesBase} onBase={setChangesBase} onRefresh={refreshChanges} onClose={() => toggleChanges(false)} />
        )}
      </div>
    </div>
  );
}
