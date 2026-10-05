import { Bot, ClipboardList } from 'lucide-react';
import { memo, useState, type ReactNode } from 'react';
import { useOpenIn } from '../OpenInButton.tsx';
import { DiffView } from './DiffView.tsx';
import { ActivityGroupView } from './ActivityGroup.tsx';
import type { RenderItem } from './displayItems.ts';
import { Markdown } from './Markdown.tsx';
import { MessageToolbar } from './messageActions.tsx';
import { ToolDetails, ToolImages, type ToolItem } from './ToolDetails.tsx';
import { TranscriptImage } from './TranscriptImage.tsx';
import { parseTodos, TodoList } from './TodoList.tsx';
import { editHunks, toolSummary } from './toolSummary.ts';

function Disclosure({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onToggle} className="flex w-full min-w-0 items-center gap-2 text-left">
      <span className={`inline-block w-3 shrink-0 text-[9px] text-faint transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
      {children}
    </button>
  );
}

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** The file a tool touched (absolute path) and, for Read, the line it started at. */
function fileTarget(item: ToolItem): { path: string; line?: number } | null {
  if (!FILE_TOOLS.has(item.name)) return null;
  const input = item.input as { file_path?: unknown; notebook_path?: unknown; offset?: unknown };
  const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null;
  if (!path?.startsWith('/')) return null;
  return typeof input.offset === 'number' && input.offset > 0 ? { path, line: input.offset } : { path };
}

function ResultDot({ item }: { item: ToolItem }) {
  const state = item.result === null ? 'pending' : item.result.isError ? 'error' : 'ok';
  return (
    <span
      className={`size-1.5 shrink-0 rounded-full ${state === 'ok' ? 'bg-ok' : state === 'error' ? 'bg-error' : 'bg-faint'}`}
      title={state === 'pending' ? 'No result yet' : state === 'error' ? 'Failed' : 'Succeeded'}
    />
  );
}

function ToolCard({ item, cwd, sessionId }: { item: ToolItem; cwd: string | null; sessionId: string }) {
  const [open, setOpen] = useState(false);
  const openIn = useOpenIn();
  const target = fileTarget(item);
  const hunks = editHunks(item);
  const isAgent = item.name === 'Task' || item.name === 'Agent';
  const { label, detail } = toolSummary(item.name, item.input, cwd);
  const failed = item.result?.isError ?? false;

  return (
    <div className="rounded-md border border-border bg-card/60 px-3 py-1.5" data-tool={item.name}>
      <Disclosure open={open} onToggle={() => setOpen((o) => !o)}>
        {isAgent ? <Bot size={13} className="shrink-0 text-accent-ink" /> : <ResultDot item={item} />}
        <span className="shrink-0 text-[12px] font-medium">{label}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{detail}</span>
        {isAgent && item.result === null && <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-accent-ink/25 border-t-accent-ink" title="Running" />}
        {target && (
          <span
            role="link"
            tabIndex={0}
            title={`Open ${target.path} in your editor`}
            onClick={(e) => {
              e.stopPropagation();
              void openIn(target.path, target.line ? { line: target.line } : {}).catch(() => {});
            }}
            className="shrink-0 rounded px-1 text-[11px] text-faint hover:bg-border/60 hover:text-accent-ink"
          >
            Open ↗
          </span>
        )}
      </Disclosure>

      {/* File changes show their diff without expanding, like the CLI. */}
      {hunks && !failed && <DiffView hunks={hunks} truncated={item.inputTruncated} />}

      {/* Images a tool returned (e.g. reading a screenshot) are shown right away. */}
      <ToolImages item={item} sessionId={sessionId} />

      {open && (
        <div className="mt-2 pb-1">
          <ToolDetails item={item} cwd={cwd} sessionId={sessionId} />
        </div>
      )}
      {!open && failed && item.result && <p className="mt-1 line-clamp-2 font-mono text-[11.5px] text-error">{item.result.text}</p>}
    </div>
  );
}

function PlanCard({ item }: { item: ToolItem }) {
  const plan = (item.input as { plan?: unknown }).plan;
  const verdict = item.result === null ? null : item.result.isError ? 'Not approved' : 'Approved';
  return (
    <div className="rounded-lg border border-accent-ink/30 bg-card px-4 py-3" data-plan>
      <p className="mb-1 flex items-center gap-2 text-[12px] font-medium text-muted">
        <ClipboardList size={14} className="text-accent-ink" /> Plan
        {verdict && <span className={`rounded px-1.5 text-[10px] ${verdict === 'Approved' ? 'bg-ok/15 text-ok' : 'bg-border text-muted'}`}>{verdict}</span>}
      </p>
      <Markdown text={typeof plan === 'string' ? plan : ''} />
    </div>
  );
}

/** A background agent's final report (Every step mode; summarised, it's a step in the group). */
function AgentReport({ title, text, failed }: { title: string; text: string; failed: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border bg-card/60 px-3 py-1.5" data-agent-report>
      <Disclosure open={open} onToggle={() => setOpen((o) => !o)}>
        <Bot size={13} className="shrink-0 text-accent-ink" />
        <span className={`min-w-0 flex-1 truncate text-[12px] ${failed ? 'text-error' : 'text-muted'}`}>{title}</span>
      </Disclosure>
      {open && (
        <div className="mt-2 pb-1">
          <Markdown text={text} />
        </div>
      )}
    </div>
  );
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[12px] text-faint">
      <Disclosure open={open} onToggle={() => setOpen((o) => !o)}>
        <span className="italic">Thinking</span>
      </Disclosure>
      {open && <p className="mt-1 ml-5 whitespace-pre-wrap text-muted italic select-text">{text}</p>}
    </div>
  );
}

/** One rendered transcript item. Memoised by item, since finished items never change. */
export const TranscriptItem = memo(function TranscriptItem({
  item,
  cwd,
  sessionId,
  active = false,
  activeLabel = null,
}: {
  item: RenderItem;
  cwd: string | null;
  sessionId: string;
  /** For an activity group: Claude is working on it now. */
  active?: boolean;
  activeLabel?: string | null;
}) {
  if (item.kind === 'activity') return <ActivityGroupView group={item} cwd={cwd} sessionId={sessionId} active={active} activeLabel={activeLabel} />;
  const indent = 'subagent' in item && item.subagent ? 'ml-6 border-l border-border pl-3' : '';
  switch (item.kind) {
    case 'user':
      return (
        <div className="group/message relative rounded-lg border border-border bg-card px-3.5 py-2.5">
          {!item.subagent && <MessageToolbar itemKey={item.key} kind="user" text={item.text} />}
          {/* Your prompts render as Markdown too, so code and code blocks are styled. */}
          {item.text && (
            <div className="text-[13.5px] leading-relaxed [&_p]:whitespace-pre-wrap [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
              <Markdown text={item.text} />
            </div>
          )}
          {item.images.length > 0 && (
            <div className={`flex flex-wrap gap-2 ${item.text ? 'mt-2' : ''}`}>
              {item.images.map((image) => (
                <TranscriptImage key={image.imageId} sessionId={sessionId} image={image} maxHeight={200} />
              ))}
            </div>
          )}
        </div>
      );
    case 'command':
      return (
        <div className="flex items-center gap-2 font-mono text-[12px]">
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent-ink">{item.name}</span>
          {item.args && <span className="truncate text-muted">{item.args}</span>}
        </div>
      );
    case 'text':
      return (
        <div className={`group/message relative ${indent}`}>
          {!item.subagent && <MessageToolbar itemKey={item.key} kind="text" text={item.text} />}
          <Markdown text={item.text} />
        </div>
      );
    case 'thinking':
      return <Thinking text={item.text} />;
    case 'tool':
      if (item.name === 'TodoWrite') {
        return (
          <div className={`rounded-md border border-border bg-card/60 px-3 py-2 ${indent}`} data-tool="TodoWrite">
            <TodoList todos={parseTodos(item.input)} />
          </div>
        );
      }
      if (item.name === 'ExitPlanMode') return <PlanCard item={item} />;
      return (
        <div className={indent}>
          <ToolCard item={item} cwd={cwd} sessionId={sessionId} />
        </div>
      );
    case 'agent-report':
      return <AgentReport title={item.title} text={item.text} failed={item.status !== 'completed'} />;
    case 'notice':
      return <p className="text-center text-[11px] whitespace-pre-wrap text-faint">{item.text}</p>;
  }
});
