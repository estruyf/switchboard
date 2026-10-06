import { Plus, Sparkles, Square, SquareTerminal, X } from 'lucide-react';
import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { TerminalInfo, TerminalKind } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { XTerm } from './XTerm.tsx';

interface Blocked {
  code: string;
  message: string;
}

/** Terminals for one session: login shells in its folder and the Claude Code TUI (labelled "Claude Code" in the UI). Toggle with ⌘J. */
export function TerminalPanel({ sessionId, cwd }: { sessionId: string; cwd: string | null }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const all = useTerminals((s) => s.terminals);
  const height = useTerminals((s) => s.panelHeight);
  const setHeight = useTerminals((s) => s.setPanelHeight);
  const activeId = useTerminals((s) => s.active.get(sessionId));
  const setActive = useTerminals((s) => s.setActive);
  const togglePanel = useTerminals((s) => s.togglePanel);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idPrefix = useId();
  const tabId = (t: TerminalInfo) => `${idPrefix}-tab-${t.id}`;
  const panelId = (t: TerminalInfo) => `${idPrefix}-panel-${t.id}`;

  const terminals = useMemo(() => [...all.values()].filter((t) => t.sessionId === sessionId).sort((a, b) => a.startedAt - b.startedAt), [all, sessionId]);
  const active = terminals.find((t) => t.id === activeId) ?? terminals.at(-1);

  const open = async (kind: TerminalKind, extra: { fork?: boolean } = {}) => {
    if (!client || !cwd) return;
    setError(null);
    setBlocked(null);
    try {
      const info = await client.call('terminal.open', { sessionId, cwd, kind, cols: 100, rows: 20, fork: extra.fork ?? false });
      setActive(sessionId, info.id);
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      const message = e instanceof Error ? e.message : String(e);
      if (code === 'SESSION_RUNNING_HERE' || code === 'SESSION_BUSY_ELSEWHERE') setBlocked({ code, message });
      else setError(`Couldn't open the terminal: ${message}`);
    }
  };

  const stopAndOpen = async () => {
    if (!client) return;
    await client.call('session.close', { sessionId });
    // Let the process leave before Claude Code opens the session again.
    await new Promise((resolve) => setTimeout(resolve, 600));
    await open('claude');
  };

  const close = (terminal: TerminalInfo) => void client?.call('terminal.close', { id: terminal.id });

  const stop = (terminal: TerminalInfo) => void client?.call('terminal.stop', { id: terminal.id }).catch((e: Error) => setError(`Couldn't stop it: ${e.message}`));

  /** An action runs again in its own tab (the engine checks it is still approved); shells and the TUI open a fresh tab. */
  const restart = async (terminal: TerminalInfo) => {
    if (terminal.kind !== 'action') {
      close(terminal);
      return open(terminal.kind);
    }
    if (!client) return;
    setError(null);
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
    <section aria-label="Terminal" className="flex shrink-0 flex-col border-t border-border bg-sidebar" style={{ height }} data-terminal-panel>
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
                    className={`group flex h-6 shrink-0 items-center gap-1.5 rounded-md pr-1 pl-2 text-[12px] ${selected ? 'bg-card text-text' : 'text-muted hover:text-text'}`}
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
                      onClick={() => close(t)}
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
          <button type="button" data-new-terminal onClick={() => void open('shell')} disabled={!cwd} data-tooltip="New terminal tab" aria-label="New terminal tab" className="ml-1 rounded-md p-1 text-muted hover:bg-border/50 hover:text-text disabled:opacity-40">
            <Plus size={13} />
          </button>
          <button
            type="button"
            data-open-claude-tui
            onClick={() => void open('claude')}
            disabled={!cwd}
            data-tooltip="Open this session in Claude Code's terminal interface (mods, status line and every CLI feature)"
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted hover:bg-border/50 hover:text-text disabled:opacity-40"
          >
            <Sparkles size={12} /> Claude Code
          </button>
        </div>
        <button type="button" onClick={() => togglePanel(false)} data-tooltip="Hide terminal (⌘J)" aria-label="Hide terminal" aria-keyshortcuts="Meta+J" className="rounded-md p-1 text-muted hover:bg-border/50 hover:text-text">
          <X size={13} />
        </button>
      </div>

      {(blocked || error) && (
        <div role="alert" className="mx-2 mb-1 flex flex-wrap items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-[12px]">
          <span className="min-w-0 flex-1">{blocked?.message ?? error}</span>
          {blocked?.code === 'SESSION_RUNNING_HERE' && (
            <button type="button" onClick={() => void stopAndOpen()} className="rounded-md border border-border bg-card px-2 py-0.5">
              Stop it here and open
            </button>
          )}
          {blocked && (
            <button type="button" onClick={() => void open('claude', { fork: true })} className="rounded-md border border-border bg-card px-2 py-0.5">
              Open a fork
            </button>
          )}
          <button type="button" onClick={() => (setBlocked(null), setError(null))} className="text-muted hover:text-text" aria-label="Dismiss" data-tooltip="Dismiss">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {terminals.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px] text-muted">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void open('shell')} disabled={!cwd} className="rounded-md border border-border bg-card px-2.5 py-1 text-text hover:bg-border/50 disabled:opacity-50">
                Open a terminal here
              </button>
              or
              <button
                type="button"
                onClick={() => void open('claude')}
                disabled={!cwd}
                data-tooltip="Claude Code's own terminal interface, on this session"
                className="rounded-md border border-border bg-card px-2.5 py-1 text-text hover:bg-border/50 disabled:opacity-50"
              >
                Open in Claude Code
              </button>
            </div>
            {/* Say why both are greyed out. */}
            {!cwd && <p>This session has no folder to open a terminal in.</p>}
          </div>
        ) : (
          terminals.map((t) => (
            <div key={t.id} id={panelId(t)} role="tabpanel" aria-labelledby={tabId(t)} className={t.id === active?.id ? 'absolute inset-0' : 'hidden'}>
              <XTerm id={t.id} active={t.id === active?.id} />
              {t.exitCode !== null && t.id === active?.id && (
                <div role="status" className="absolute right-3 bottom-2 flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted shadow" data-terminal-exited>
                  Exited with code {t.exitCode}
                  <button type="button" onClick={() => void restart(t)} className="text-accent-ink hover:underline" data-terminal-restart>
                    Restart
                  </button>
                </div>
              )}
              {t.exitCode === null && t.kind === 'action' && t.id === active?.id && (
                <button
                  type="button"
                  onClick={() => stop(t)}
                  data-terminal-stop
                  data-tooltip="Stop the command (⌃C)"
                  className="absolute right-3 bottom-2 flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted shadow hover:text-text"
                >
                  <Square size={10} className="fill-current" /> Stop
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
