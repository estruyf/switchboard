import { Bot, ClipboardList } from 'lucide-react';
import { memo, useState, type ReactNode } from 'react';
import { useOpenIn } from '../OpenInButton.tsx';
import { DiffView } from './DiffView.tsx';
import type { DisplayItem } from './displayItems.ts';
import { Markdown } from './Markdown.tsx';
import { SubagentRun } from './SubagentRun.tsx';
import { TranscriptImage } from './TranscriptImage.tsx';
import { parseTodos, TodoList } from './TodoList.tsx';
import { editHunks, toolSummary } from './toolSummary.ts';

type ToolItem = Extract<DisplayItem, { kind: 'tool' }>;

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
        {isAgent ? <Bot size={13} className="shrink-0 text-accent" /> : <ResultDot item={item} />}
        <span className="shrink-0 text-[12px] font-medium">{label}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{detail}</span>
        {isAgent && item.result === null && <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-accent/25 border-t-accent" title="Running" />}
        {target && (
          <span
            role="link"
            tabIndex={0}
            title={`Open ${target.path} in your editor`}
            onClick={(e) => {
              e.stopPropagation();
              void openIn(target.path, target.line ? { line: target.line } : {}).catch(() => {});
            }}
            className="shrink-0 rounded px-1 text-[11px] text-faint hover:bg-border/60 hover:text-accent"
          >
            Open ↗
          </span>
        )}
      </Disclosure>

      {/* File changes show their diff without expanding, like the CLI. */}
      {hunks && !failed && <DiffView hunks={hunks} truncated={item.inputTruncated} />}

      {/* Images a tool returned (e.g. reading a screenshot) are shown right away. */}
      {item.result && item.result.images.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {item.result.images.map((image) => (
            <TranscriptImage key={image.imageId} sessionId={sessionId} image={image} />
          ))}
        </div>
      )}

      {open && isAgent && (
        <div className="mt-2">
          <SubagentRun sessionId={sessionId} toolUseId={item.id} running={item.result === null} cwd={cwd} />
        </div>
      )}

      {open && !isAgent && (
        <div className="mt-2 grid gap-2 pb-1 select-text">
          {!hunks && (
            <pre className="max-h-64 overflow-auto rounded bg-sidebar px-2 py-1.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted">
              {JSON.stringify(item.input, null, 2)}
              {item.inputTruncated && '\n… (long values shortened)'}
            </pre>
          )}
          {item.result && (
            <pre
              className={`max-h-80 overflow-auto rounded px-2 py-1.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap ${
                item.result.isError ? 'bg-error/10 text-error' : 'bg-sidebar text-text/85'
              }`}
            >
              {item.result.text || '(no output)'}
              {item.result.truncated && '\n… (output shortened)'}
            </pre>
          )}
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
    <div className="rounded-lg border border-accent/30 bg-card px-4 py-3" data-plan>
      <p className="mb-1 flex items-center gap-2 text-[12px] font-medium text-muted">
        <ClipboardList size={14} className="text-accent" /> Plan
        {verdict && <span className={`rounded px-1.5 text-[10px] ${verdict === 'Approved' ? 'bg-ok/15 text-ok' : 'bg-border text-muted'}`}>{verdict}</span>}
      </p>
      <Markdown text={typeof plan === 'string' ? plan : ''} />
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
export const TranscriptItem = memo(function TranscriptItem({ item, cwd, sessionId }: { item: DisplayItem; cwd: string | null; sessionId: string }) {
  const indent = 'subagent' in item && item.subagent ? 'ml-6 border-l border-border pl-3' : '';
  switch (item.kind) {
    case 'user':
      return (
        <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
          {item.text && <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap select-text">{item.text}</p>}
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
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">{item.name}</span>
          {item.args && <span className="truncate text-muted">{item.args}</span>}
        </div>
      );
    case 'text':
      return (
        <div className={indent}>
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
    case 'notice':
      return <p className="text-center text-[11px] whitespace-pre-wrap text-faint">{item.text}</p>;
  }
});
