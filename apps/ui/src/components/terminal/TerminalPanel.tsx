import { Plus, Sparkles, SquareTerminal, X } from 'lucide-react';
import { useMemo, useState, type PointerEvent } from 'react';
import type { TerminalInfo, TerminalKind } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { XTerm } from './XTerm.tsx';

interface Blocked {
  code: string;
  message: string;
}

/** Terminals for one session: login shells in its folder and the Claude Code TUI. Toggle with ⌘J. */
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
      else setError(message);
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

  return (
    <section className="flex shrink-0 flex-col border-t border-border bg-sidebar" style={{ height }} data-terminal-panel>
      <div onPointerDown={startResize} className="h-1 shrink-0 cursor-row-resize hover:bg-accent/40" title="Drag to resize" />
      <div className="flex h-8 shrink-0 items-center gap-1 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {terminals.map((t) => (
            <div
              key={t.id}
              className={`group flex h-6 shrink-0 items-center gap-1.5 rounded-md pr-1 pl-2 text-[12px] ${t.id === active?.id ? 'bg-card text-text' : 'text-muted hover:text-text'}`}
            >
              <button type="button" onClick={() => setActive(sessionId, t.id)} className="flex items-center gap-1.5">
                {t.kind === 'claude' ? <Sparkles size={12} className="text-accent-ink" /> : <SquareTerminal size={12} />}
                {t.title}
                {t.exitCode !== null && <span className={t.exitCode === 0 ? 'text-faint' : 'text-error'}>({t.exitCode})</span>}
              </button>
              <button type="button" onClick={() => close(t)} className="rounded p-0.5 text-faint opacity-0 group-hover:opacity-100 hover:text-text" aria-label={`Close ${t.title}`}>
                <X size={11} />
              </button>
            </div>
          ))}
          <button type="button" data-new-terminal onClick={() => void open('shell')} title="New terminal" className="ml-1 rounded-md p-1 text-muted hover:bg-border/50 hover:text-text">
            <Plus size={13} />
          </button>
          <button
            type="button"
            data-open-claude-tui
            onClick={() => void open('claude')}
            title="Open this session in the Claude Code terminal UI (mods, statusline and every CLI feature)"
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted hover:bg-border/50 hover:text-text"
          >
            <Sparkles size={12} /> Claude TUI
          </button>
        </div>
        <button type="button" onClick={() => togglePanel(false)} title="Hide terminal (⌘J)" className="rounded-md p-1 text-muted hover:bg-border/50 hover:text-text">
          <X size={13} />
        </button>
      </div>

      {(blocked || error) && (
        <div className="mx-2 mb-1 flex flex-wrap items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-[12px]">
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
          <button type="button" onClick={() => (setBlocked(null), setError(null))} className="text-faint hover:text-text" aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {terminals.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-faint">
            <button type="button" onClick={() => void open('shell')} disabled={!cwd} className="rounded-md border border-border bg-card px-2.5 py-1 text-text hover:bg-border/50">
              Open a terminal here
            </button>
            or
            <button type="button" onClick={() => void open('claude')} disabled={!cwd} className="rounded-md border border-border bg-card px-2.5 py-1 text-text hover:bg-border/50">
              Open in Claude TUI
            </button>
          </div>
        ) : (
          terminals.map((t) => (
            <div key={t.id} className={t.id === active?.id ? 'absolute inset-0' : 'hidden'}>
              <XTerm id={t.id} active={t.id === active?.id} />
              {t.exitCode !== null && t.id === active?.id && (
                <div className="absolute right-3 bottom-2 flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted shadow">
                  Exited with code {t.exitCode}
                  <button type="button" onClick={() => (close(t), void open(t.kind))} className="text-accent-ink hover:underline">
                    Restart
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
