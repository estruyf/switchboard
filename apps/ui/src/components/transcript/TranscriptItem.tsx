import { memo, useState } from 'react';
import type { DisplayItem } from './displayItems.ts';
import { Markdown } from './Markdown.tsx';
import { toolSummary } from './toolSummary.ts';

function Disclosure({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onToggle} className="flex w-full min-w-0 items-center gap-2 text-left">
      <span className={`inline-block w-3 shrink-0 text-[9px] text-faint transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
      {children}
    </button>
  );
}

function ToolCard({ item, cwd }: { item: Extract<DisplayItem, { kind: 'tool' }>; cwd: string | null }) {
  const [open, setOpen] = useState(false);
  const { label, detail } = toolSummary(item.name, item.input, cwd);
  const state = item.result === null ? 'pending' : item.result.isError ? 'error' : 'ok';
  return (
    <div className="rounded-md border border-border bg-card/60 px-3 py-1.5">
      <Disclosure open={open} onToggle={() => setOpen((o) => !o)}>
        <span
          className={`size-1.5 shrink-0 rounded-full ${state === 'ok' ? 'bg-ok' : state === 'error' ? 'bg-error' : 'bg-faint'}`}
          title={state === 'pending' ? 'No result recorded' : state === 'error' ? 'Failed' : 'Succeeded'}
        />
        <span className="shrink-0 text-[12px] font-medium">{label}</span>
        <span className="min-w-0 truncate font-mono text-[12px] text-muted">{detail}</span>
      </Disclosure>
      {open && (
        <div className="mt-2 grid gap-2 pb-1 select-text">
          <pre className="max-h-64 overflow-auto rounded bg-sidebar px-2 py-1.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted">
            {JSON.stringify(item.input, null, 2)}
            {item.inputTruncated && '\n… (long values shortened)'}
          </pre>
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
export const TranscriptItem = memo(function TranscriptItem({ item, cwd }: { item: DisplayItem; cwd: string | null }) {
  const indent = 'subagent' in item && item.subagent ? 'ml-6 border-l border-border pl-3' : '';
  switch (item.kind) {
    case 'user':
      return (
        <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
          <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap select-text">{item.text}</p>
          {item.images > 0 && <p className="mt-1 text-[11px] text-faint">{item.images === 1 ? '1 image' : `${item.images} images`} attached</p>}
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
      return (
        <div className={indent}>
          <ToolCard item={item} cwd={cwd} />
        </div>
      );
    case 'notice':
      return <p className="text-center text-[11px] whitespace-pre-wrap text-faint">{item.text}</p>;
  }
});
