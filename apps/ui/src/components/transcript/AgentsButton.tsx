import { Bot, ChevronRight, CircleAlert, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useModalFocus } from '../ui/useModalFocus.ts';
import { formatDuration, useTicker } from './ActivityGroup.tsx';
import type { DisplayItem } from './displayItems.ts';
import { agentRuns, type AgentRun } from './agentRuns.ts';
import { SubagentRun } from './SubagentRun.tsx';
import type { ToolItem } from './ToolDetails.tsx';

const describe = (item: ToolItem) => {
  const input = (item.input ?? {}) as { description?: unknown; subagent_type?: unknown; prompt?: unknown };
  return {
    type: typeof input.subagent_type === 'string' ? input.subagent_type : 'agent',
    what: typeof input.description === 'string' ? input.description : typeof input.prompt === 'string' ? input.prompt.slice(0, 100) : 'Agent',
  };
};

function AgentRow({ run, sessionId, cwd, now, initiallyOpen }: { run: AgentRun; sessionId: string; cwd: string | null; now: number; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const runId = useId();
  const { item, running } = run;
  const failed = item.result?.isError ?? false;
  const { type, what } = describe(item);
  // A background agent's call returns at once; its own run ends with its report, which we don't time.
  const end = running ? now : run.background ? null : (item.result?.at ?? null);
  return (
    <div className="border-b border-border last:border-b-0" data-agent-run={running ? 'running' : 'done'}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? runId : undefined}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-[12.5px] hover:bg-border/30"
      >
        <ChevronRight size={13} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
        {running ? (
          <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-accent-ink/25 border-t-accent-ink" aria-hidden />
        ) : failed ? (
          <CircleAlert size={13} className="shrink-0 text-error" aria-hidden />
        ) : (
          <span className="size-2 shrink-0 rounded-full bg-ok" aria-hidden />
        )}
        {/* The icon shows the state; say it in words for screen readers. */}
        <span className="sr-only">{running ? 'Running: ' : failed ? 'Failed: ' : 'Finished: '}</span>
        <span className="min-w-0 flex-1 truncate">{what}</span>
        <span className="shrink-0 rounded bg-border/60 px-1.5 text-[11px] text-muted" data-tooltip="Agent type">
          {type}
        </span>
        {run.background && (
          <span className="shrink-0 text-[11px] text-muted" data-tooltip="Runs in the background while Claude carries on">
            background
          </span>
        )}
        {item.at !== null && end !== null && <span className="shrink-0 text-[11px] text-muted tabular-nums">{formatDuration(end - item.at)}</span>}
      </button>
      {open && (
        <div id={runId} className="px-4 pb-3">
          <SubagentRun sessionId={sessionId} toolUseId={item.id} running={running} cwd={cwd} />
        </div>
      )}
    </div>
  );
}

/**
 * Agents Claude started in this session, as a pill in the header while any are running
 * ("2 agents"). Click it to see each one's progress and what it's doing.
 */
export function AgentsButton({ items, sessionId, cwd, sessionOpen }: { items: readonly DisplayItem[]; sessionId: string; cwd: string | null; sessionOpen: boolean }) {
  const agents = useMemo(() => agentRuns(items, sessionOpen).reverse(), [items, sessionOpen]);
  const running = agents.filter((a) => a.running);
  const [open, setOpen] = useState(false);
  const now = useTicker(open && running.length > 0);
  const label = `${running.length} ${running.length === 1 ? 'agent' : 'agents'}`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (running.length === 0 && !open) return null;
  return (
    <>
      <button
        type="button"
        data-agents-button
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${label} running: show what they’re doing`}
        data-tooltip="Agents Claude started in this session: click to see what each is doing"
        className="no-drag flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-accent-ink/40 bg-accent/10 px-2.5 text-[11.5px] text-text hover:bg-accent/20"
      >
        <Bot size={13} className="text-accent-ink" />
        {label}
      </button>
      {open && <AgentsDialog agents={agents} running={running.length} sessionId={sessionId} cwd={cwd} now={now} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The list of agents, as a modal: Tab stays inside, and focus goes back to the pill when it closes. */
function AgentsDialog({ agents, running, sessionId, cwd, now, onClose }: { agents: AgentRun[]; running: number; sessionId: string; cwd: string | null; now: number; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(ref);
  return (
    <div className="no-drag fixed inset-0 z-[60] flex items-start justify-center bg-scrim pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="flex max-h-[76vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-xl border overlay outline-none" data-agents>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
          <Bot size={15} className="text-accent-ink" />
          <h2 id={titleId} className="text-[13px] font-semibold">Agents</h2>
          <span className="flex-1 text-[11.5px] text-muted">
            {running} running{agents.length > running ? ` · ${agents.length - running} finished` : ''}
          </span>
          <button type="button" data-tooltip="Close (Esc)" aria-label="Close" onClick={onClose} className="flex size-6 items-center justify-center rounded text-muted hover:bg-border/60 hover:text-text">
            <X size={13} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {agents.length === 0 && <p className="p-4 text-[12px] text-muted">No agents in this session.</p>}
          {agents.map((run, i) => (
            <AgentRow key={run.item.key} run={run} sessionId={sessionId} cwd={cwd} now={now || Date.now()} initiallyOpen={i === 0 && run.running} />
          ))}
        </div>
      </div>
    </div>
  );
}
