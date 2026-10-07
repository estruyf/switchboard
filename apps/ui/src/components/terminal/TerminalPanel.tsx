import { Plus, RotateCcw, Sparkles, Square, SquareTerminal, X } from 'lucide-react';
import { useEffect, useId, useMemo, type KeyboardEvent, type PointerEvent } from 'react';
import type { TerminalInfo, TerminalKind } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { openTerminal, useTerminals } from '../../state/terminalsStore.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { XTerm } from './XTerm.tsx';

/**
 * Terminals for one session: login shells in its folder, project actions, and the Claude Code TUI
 * (opened from the ⋯ menu). Toggle with ⌘J; opening it on a session without terminals starts a shell.
 */
export function TerminalPanel({ sessionId, cwd }: { sessionId: string; cwd: string | null }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const all = useTerminals((s) => s.terminals);
  const height = useTerminals((s) => s.panelHeight);
  const setHeight = useTerminals((s) => s.setPanelHeight);
  const activeId = useTerminals((s) => s.active.get(sessionId));
  const setActive = useTerminals((s) => s.setActive);
  const togglePanel = useTerminals((s) => s.togglePanel);
  const loaded = useTerminals((s) => s.loaded);
  const shellWanted = useTerminals((s) => s.shellWanted);
  const notice = useTerminals((s) => s.notices.get(sessionId) ?? null);
  const setNotice = useTerminals((s) => s.setNotice);
  const setError = (message: string) => setNotice(sessionId, { code: null, message });
  const blocked = notice?.code === 'SESSION_RUNNING_HERE' || notice?.code === 'SESSION_BUSY_ELSEWHERE' ? notice : null;
  const idPrefix = useId();
  const tabId = (t: TerminalInfo) => `${idPrefix}-tab-${t.id}`;
  const panelId = (t: TerminalInfo) => `${idPrefix}-panel-${t.id}`;

  const terminals = useMemo(() => [...all.values()].filter((t) => t.sessionId === sessionId).sort((a, b) => a.startedAt - b.startedAt), [all, sessionId]);
  const active = terminals.find((t) => t.id === activeId) ?? terminals.at(-1);

  const open = async (kind: TerminalKind, extra: { fork?: boolean } = {}) => {
    if (client && cwd) await openTerminal(client, sessionId, cwd, kind, extra.fork ?? false);
  };

  // Opening the panel (Terminal button, ⌘J) on a session without terminals starts a shell right away.
  useEffect(() => {
    if (!shellWanted || !loaded || !client) return;
    useTerminals.getState().setShellWanted(false);
    if (terminals.length === 0 && cwd) void openTerminal(client, sessionId, cwd, 'shell');
  }, [shellWanted, loaded, client, terminals.length, cwd, sessionId]);

  const stopAndOpen = async () => {
    if (!client) return;
    await client.call('session.close', { sessionId });
    // Let the process leave before Claude Code opens the session again.
    await new Promise((resolve) => setTimeout(resolve, 600));
    await open('claude');
  };

  const close = (terminal: TerminalInfo) => void client?.call('terminal.close', { id: terminal.id });

  /** Closing the last tab hides the panel too; the next ⌘J starts a fresh shell. */
  const closeTab = (terminal: TerminalInfo) => {
    close(terminal);
    if (terminals.length === 1) togglePanel(false);
  };

  const stop = (terminal: TerminalInfo) => void client?.call('terminal.stop', { id: terminal.id }).catch((e: Error) => setError(`Couldn't stop it: ${e.message}`));

  /** An action runs again in its own tab (the engine checks it is still approved); shells and the TUI open a fresh tab. */
  const restart = async (terminal: TerminalInfo) => {
    if (terminal.kind !== 'action') {
      close(terminal);
      return open(terminal.kind);
    }
    if (!client) return;
    setNotice(sessionId, null);
    try {
      await client.call('terminal.restart', { id: terminal.id });
    } catch (e) {
      setError(`Couldn't restart it: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Drag the top edge to resize.
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const startY = event.clientY;
    const startHeight = height;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => setHeight(startHeight + (startY - e.clientY));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  // The same resize from the keyboard: ↑ makes the panel taller, ↓ shorter.
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowUp' ? 24 : event.key === 'ArrowDown' ? -24 : 0;
    if (!step) return;
    event.preventDefault();
    setHeight(height + step);
  };

  // ← → Home End move between tabs and show the one they land on, as in any tab bar.
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = terminals.findIndex((t) => t.id === active?.id);
    if (index < 0) return;
    const next =
      event.key === 'ArrowRight' ? (index + 1) % terminals.length : event.key === 'ArrowLeft' ? (index - 1 + terminals.length) % terminals.length : event.key === 'Home' ? 0 : event.key === 'End' ? terminals.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = terminals[next]!;
    setActive(sessionId, target.id);
    document.getElementById(tabId(target))?.focus();
  };

  return (
    <section aria-label="Terminal" className="theme-dark flex shrink-0 flex-col border-t border-border bg-bg text-text" style={{ height }} data-terminal-panel>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Terminal height"
        aria-valuenow={height}
        aria-valuemin={120}
        aria-valuemax={Math.round(window.innerHeight * 0.75)}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeByKey}
        className="h-1 shrink-0 cursor-row-resize hover:bg-accent/40 focus-visible:bg-accent/40"
        data-tooltip="Drag (or use ↑ ↓) to resize"
      />
      <div className="flex h-8 shrink-0 items-center gap-1 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {terminals.length > 0 && (
            <div role="tablist" aria-label="Terminal tabs" onKeyDown={onTabKey} className="flex shrink-0 items-center gap-0.5">
              {terminals.map((t) => {
                const selected = t.id === active?.id;
                return (
                  <div
                    key={t.id}
                    className={`group flex h-6 shrink-0 items-center gap-1.5 rounded-md pr-1 pl-2 text-ui ${selected ? 'bg-card text-text' : 'text-muted hover:text-text'}`}
                  >
                    <button
                      type="button"
                      role="tab"
                      id={tabId(t)}
                      aria-selected={selected}
                      aria-controls={panelId(t)}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setActive(sessionId, t.id)}
                      className="flex items-center gap-1.5"
                    >
                      {t.kind === 'claude' ? <Sparkles size={12} className="text-accent-ink" /> : <SquareTerminal size={12} />}
                      {t.title}
                      {t.exitCode !== null && (
                        <span className={t.exitCode === 0 ? 'text-muted' : 'text-error'} data-tooltip={`Exited with code ${t.exitCode}`}>
                          <span aria-hidden>({t.exitCode})</span>
                          <span className="sr-only">, exited with code {t.exitCode}</span>
                        </span>
                      )}
                    </button>
                    {/* Always there on the selected tab (so the keyboard reaches it), on hover for the others. */}
                    <button
                      type="button"
                      onClick={() => closeTab(t)}
                      tabIndex={selected ? 0 : -1}
                      className={`rounded p-0.5 text-muted group-hover:opacity-100 hover:text-text focus-visible:opacity-100 ${selected ? '' : 'opacity-0'}`}
                      aria-label={`Close ${t.title}`}
                      data-tooltip={`Close ${t.title}`}
                    >
                      <X size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <Button variant="quiet" size="sm" iconOnly icon={<Plus size={13} />} data-new-terminal onClick={() => void open('shell')} disabled={!cwd} aria-label="New terminal tab" className="ml-1" />
        </div>
        <Button variant="quiet" size="sm" iconOnly icon={<X size={13} />} kbd="⌘J" onClick={() => togglePanel(false)} aria-label="Hide terminal" />
      </div>

      {notice && (
        <Notice
          tone="warn"
          role="alert"
          className="mx-2 mb-1"
          data-terminal-notice
          onDismiss={() => setNotice(sessionId, null)}
          actions={
            <>
              {blocked?.code === 'SESSION_RUNNING_HERE' && (
                <Button size="sm" onClick={() => void stopAndOpen()}>
                  Stop it here and open
                </Button>
              )}
              {blocked && (
                <Button size="sm" onClick={() => void open('claude', { fork: true })}>
                  Open a fork
                </Button>
              )}
            </>
          }
        >
          {notice.message}
        </Notice>
      )}

      <div className="relative min-h-0 flex-1">
        {terminals.length === 0 ? (
          // Opening the panel starts a shell, so this shows only for a session switched to with the panel open, or without a folder.
          <div className="flex h-full items-center justify-center text-ui text-muted">
            {cwd ? (
              <Button onClick={() => void open('shell')}>New terminal</Button>
            ) : (
              <p>This session has no folder to open a terminal in.</p>
            )}
          </div>
        ) : (
          terminals.map((t) => (
            <div key={t.id} id={panelId(t)} role="tabpanel" aria-labelledby={tabId(t)} className={t.id === active?.id ? 'absolute inset-0' : 'hidden'}>
              <XTerm id={t.id} active={t.id === active?.id} />
              {t.exitCode !== null && t.id === active?.id && (
                <div role="status" className="absolute right-3 bottom-2 flex items-center gap-2 rounded-md border border-border bg-card py-1 pr-1 pl-2.5 text-meta text-muted shadow" data-terminal-exited>
                  Exited with code {t.exitCode}
                  <Button size="sm" icon={<RotateCcw size={11} aria-hidden />} onClick={() => void restart(t)} data-terminal-restart>
                    Restart
                  </Button>
                </div>
              )}
              {t.exitCode === null && t.kind === 'action' && t.id === active?.id && (
                <div className="absolute right-3 bottom-2 rounded-md border border-border bg-card p-1 shadow">
                  <Button size="sm" icon={<Square size={10} className="fill-current" aria-hidden />} onClick={() => stop(t)} data-terminal-stop data-tooltip="Stop the command (⌃C)">
                    Stop
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
