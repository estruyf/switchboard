import { Bot, ChevronRight, CircleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
  const { item, running } = run;
  const failed = item.result?.isError ?? false;
  const { type, what } = describe(item);
  // A background agent's call returns at once; its own run ends with its report, which we don't time.
  const end = running ? now : run.background ? null : (item.result?.at ?? null);
  return (
    <div className="border-b border-border last:border-b-0" data-agent-run={running ? 'running' : 'done'}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-2 text-left text-[12.5px] hover:bg-border/30">
        <ChevronRight size={13} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
        {running ? (
          <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-accent-ink/25 border-t-accent-ink" />
        ) : failed ? (
          <CircleAlert size={13} className="shrink-0 text-error" />
        ) : (
          <span className="size-2 shrink-0 rounded-full bg-ok" />
        )}
        <span className="min-w-0 flex-1 truncate">{what}</span>
        <span className="shrink-0 rounded bg-border/60 px-1.5 text-[10.5px] text-muted">{type}</span>
        {run.background && <span className="shrink-0 text-[10.5px] text-faint">background</span>}
        {item.at !== null && end !== null && <span className="shrink-0 text-[11px] text-faint tabular-nums">{formatDuration(end - item.at)}</span>}
      </button>
      {open && (
        <div className="px-4 pb-3">
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
        title="Agents running in this session"
        className="no-drag flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-accent-ink/40 bg-accent/10 px-2.5 text-[11.5px] text-text hover:bg-accent/20"
      >
        <Bot size={13} className="text-accent-ink" />
        {running.length} {running.length === 1 ? 'agent' : 'agents'}
      </button>
      {open && (
        <div className="no-drag fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-label="Agents" className="flex max-h-[76vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl" data-agents>
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
              <Bot size={15} className="text-accent-ink" />
              <h2 className="text-[13px] font-semibold">Agents</h2>
              <span className="flex-1 text-[11.5px] text-faint">
                {running.length} running{agents.length > running.length ? ` · ${agents.length - running.length} finished` : ''}
              </span>
              <button type="button" title="Close" onClick={() => setOpen(false)} className="flex size-6 items-center justify-center rounded text-faint hover:bg-border/60 hover:text-text">
                <X size={13} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {agents.length === 0 && <p className="p-4 text-[12px] text-faint">No agents in this session.</p>}
              {agents.map((run, i) => (
                <AgentRow key={run.item.key} run={run} sessionId={sessionId} cwd={cwd} now={now || Date.now()} initiallyOpen={i === 0 && run.running} />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
