import { Bot, ChevronRight, CircleAlert } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Dialog } from '../ui/Dialog.tsx';
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
        <span className="shrink-0 rounded bg-border/60 px-1.5 text-meta text-muted" data-tooltip="Agent type">
          {type}
        </span>
        {run.background && (
          <span className="shrink-0 text-meta text-muted" data-tooltip="Runs in the background while Claude carries on">
            background
          </span>
        )}
        {item.at !== null && end !== null && <span className="shrink-0 text-meta text-muted tabular-nums">{formatDuration(end - item.at)}</span>}
      </button>
      {open && (
        <div id={runId} className="px-4 pb-3">
          <SubagentRun sessionId={sessionId} toolUseId={item.id} running={running} cwd={cwd} />
        </div>
      )}
    </div>
  );
}

/** Agents Claude started in this session, newest first, and how many are still running. */
export function useAgentRuns(items: readonly DisplayItem[], sessionOpen: boolean): { agents: AgentRun[]; running: number } {
  const agents = useMemo(() => agentRuns(items, sessionOpen).reverse(), [items, sessionOpen]);
  return { agents, running: agents.filter((a) => a.running).length };
}

/**
 * The agents Claude started in this session (from the header's More menu), with each one's progress
 * and what it's doing, as a modal: Tab stays inside, and Esc closes it.
 */
export function AgentsDialog({ agents, running, sessionId, cwd, onClose }: { agents: AgentRun[]; running: number; sessionId: string; cwd: string | null; onClose(): void }) {
  const now = useTicker(running > 0);
  return (
    <Dialog
      width="lg"
      placement="top"
      flush
      icon={<Bot size={15} className="text-accent-ink" aria-hidden />}
      title="Agents"
      subtitle={`${running} running${agents.length > running ? ` · ${agents.length - running} finished` : ''}`}
      onClose={onClose}
      data-agents
    >
      {agents.length === 0 && <p className="p-4 text-ui text-muted">No agents in this session.</p>}
      {agents.map((run, i) => (
        <AgentRow key={run.item.key} run={run} sessionId={sessionId} cwd={cwd} now={now || Date.now()} initiallyOpen={i === 0 && run.running} />
      ))}
    </Dialog>
  );
}
