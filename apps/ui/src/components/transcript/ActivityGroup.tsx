import { ChevronRight, CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ActivityGroup, DisplayItem } from './displayItems.ts';
import { Markdown } from './Markdown.tsx';
import { ToolDetails, ToolImages } from './ToolDetails.tsx';
import { activitySummary, stepLabel } from './toolSummary.ts';

/** Three dots taking turns: Claude is working. */
export function WorkingDots() {
  return (
    <span className="working-dots shrink-0" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

/** 9s, 4m 12s, 1h 5m. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Ticks once a second while `active`. */
export function useTicker(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return active ? now : 0;
}

// Open groups and steps survive scrolling out of the virtualised list and back.
const openKeys = new Set<string>();
function useOpen(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => openKeys.has(key));
  return [
    open,
    () => {
      if (open) openKeys.delete(key);
      else openKeys.add(key);
      setOpen(!open);
    },
  ];
}

const endOf = (item: DisplayItem) => (item.kind === 'tool' ? (item.result?.at ?? item.at) : item.at);

function Step({ item, cwd, sessionId }: { item: DisplayItem; cwd: string | null; sessionId: string }) {
  const [open, toggle] = useOpen(`step:${item.key}`);
  const label = stepLabel(item, cwd).past;
  const failed = item.kind === 'tool' && (item.result?.isError ?? false);
  return (
    <div data-step>
      <button type="button" onClick={toggle} className="flex w-full min-w-0 items-center gap-1.5 px-3 py-2 text-left text-[12.5px] text-muted hover:text-text">
        <span className="min-w-0 truncate">{label}</span>
        {failed && <CircleAlert size={12} className="shrink-0 text-error" aria-label="Failed" />}
        <ChevronRight size={13} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-2.5">
          {item.kind === 'tool' ? (
            <ToolDetails item={item} cwd={cwd} sessionId={sessionId} withDiffAndImages />
          ) : item.kind === 'thinking' ? (
            <p className="text-[12px] whitespace-pre-wrap text-muted italic select-text">{item.text}</p>
          ) : item.kind === 'text' || item.kind === 'user' ? (
            <Markdown text={item.text} />
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * A run of tool calls as one line, like Claude Code: while Claude works, the step it's on
 * ("Reading src/a.ts") with a timer; afterwards, what it did ("Ran 3 commands and edited a file").
 * Click to see each step, and a step to see its details.
 */
export function ActivityGroupView({
  group,
  cwd,
  sessionId,
  active,
  activeLabel,
}: {
  group: ActivityGroup;
  cwd: string | null;
  sessionId: string;
  /** This is the run Claude is working on now. */
  active: boolean;
  /** Overrides the current step while Claude is between steps (thinking, waiting for you). */
  activeLabel: string | null;
}) {
  const [open, toggle] = useOpen(group.key);
  const now = useTicker(active);
  const items = group.items;
  const last = items.at(-1)!;
  const started = items[0]!.at;
  const ended = active ? now : endOf(last);
  const duration = started !== null && ended !== null ? formatDuration(ended - started) : null;
  const failures = items.filter((i) => i.kind === 'tool' && i.result?.isError).length;
  // One step reads best as itself ("Run the unit tests"); several as what they add up to.
  const steps = items.filter((i) => i.kind !== 'thinking');
  const label = active ? (activeLabel ?? stepLabel(last, cwd).present) : steps.length === 1 ? stepLabel(steps[0]!, cwd).past : activitySummary(items);
  const images = items.filter((i) => i.kind === 'tool' && (i.result?.images.length ?? 0) > 0);

  return (
    <div data-activity={active ? 'active' : 'done'}>
      <button type="button" onClick={toggle} className="group flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-[12.5px]" title={open ? 'Hide steps' : 'Show steps'}>
        <span className="flex w-4 shrink-0 justify-center">{active ? <WorkingDots /> : failures > 0 ? <CircleAlert size={12} className="text-error" /> : <span className="size-1.5 rounded-full bg-faint/70" />}</span>
        <span className={`min-w-0 truncate ${active ? 'text-text/85' : 'text-muted group-hover:text-text'}`}>{label}</span>
        {failures > 0 && !active && <span className="shrink-0 text-error">· {failures} failed</span>}
        {duration && <span className="shrink-0 text-faint tabular-nums">{duration}</span>}
        <ChevronRight size={13} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {/* Images stay in view, like the attachments they often are (screenshots Claude took or read). */}
      {!open && images.length > 0 && (
        <div className="ml-6">
          {images.map((item) => item.kind === 'tool' && <ToolImages key={item.key} item={item} sessionId={sessionId} />)}
        </div>
      )}

      {open && (
        <div className="mt-1 ml-6 divide-y divide-border overflow-hidden rounded-lg border border-border" data-steps>
          {items.map((item) => (
            <Step key={item.key} item={item} cwd={cwd} sessionId={sessionId} />
          ))}
        </div>
      )}
    </div>
  );
}
