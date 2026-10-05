import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { guessHome, shortAge, tildify } from '../../lib/format.ts';
import { realBranch, useSessions } from '../../state/sessionsStore.ts';
import { liveLabel, StatusDot } from '../StatusDot.tsx';
import { buildDisplayItems } from './displayItems.ts';
import { TranscriptItem } from './TranscriptItem.tsx';
import { useTranscript } from './useTranscript.ts';

const ORIGIN_LABEL = { cli: 'Terminal', desktop: 'Claude desktop', ide: 'IDE', sdk: 'SDK', app: 'Switchboard', unknown: '' } as const;

/** Read-only, live-updating view of one session. */
export function TranscriptView({ sessionId }: { sessionId: string }) {
  const summary = useSessions((s) => s.sessions.get(sessionId) ?? null);
  const live = useSessions((s) => s.live.get(sessionId) ?? null);
  const home = useSessions((s) => guessHome([...s.sessions.values()].slice(0, 20).flatMap((x) => (x.cwd ? [x.cwd] : []))));
  const { status, messages } = useTranscript(sessionId);
  const items = useMemo(() => buildDisplayItems(messages), [messages]);
  const cwd = summary?.cwd ?? live?.cwd ?? null;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 6,
    getItemKey: (i) => items[i]!.key,
  });

  // Start at the bottom, and keep following new output while the user is at the bottom.
  const stickToBottom = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  useLayoutEffect(() => {
    if (items.length > 0 && stickToBottom.current) virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
  }, [items.length, virtualizer]);
  useEffect(() => {
    stickToBottom.current = true;
  }, [sessionId]);

  const branch = summary?.worktree?.branch ?? realBranch(summary?.gitBranch ?? null);
  const origin = summary ? ORIGIN_LABEL[summary.origin] : live ? ORIGIN_LABEL[live.origin] : '';
  const meta = [
    cwd && tildify(cwd, home),
    branch && (summary?.worktree ? `worktree · ${branch}` : branch),
    origin,
    summary && `updated ${shortAge(summary.updatedAt)} ago`.replace('now ago', 'just now'),
  ].filter(Boolean);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="drag flex h-13 shrink-0 items-center gap-3 border-b border-border px-6">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[13px] font-semibold">{summary?.title ?? live?.name ?? 'Session'}</h1>
          <p className="truncate text-[11px] text-faint">{meta.join('  ·  ')}</p>
        </div>
        {live && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
            <StatusDot live={live} />
            {liveLabel(live)}
          </span>
        )}
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto" data-transcript>
        {status === 'loading' ? (
          <p className="p-8 text-center text-[12px] text-faint">Loading transcript…</p>
        ) : items.length === 0 ? (
          <p className="p-8 text-center text-[12px] text-faint">This session has no messages yet.</p>
        ) : (
          <div className="relative mx-auto max-w-3xl px-6" style={{ height: virtualizer.getTotalSize() + 48 }}>
            {virtualizer.getVirtualItems().map((row) => (
              <div
                key={row.key}
                data-index={row.index}
                data-transcript-item
                ref={virtualizer.measureElement}
                className="absolute inset-x-6 pt-3"
                style={{ transform: `translateY(${row.start + 16}px)` }}
              >
                <TranscriptItem item={items[row.index]!} cwd={cwd} />
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="flex h-12 shrink-0 items-center justify-center border-t border-border text-[12px] text-faint">
        {live?.status === 'running'
          ? 'Claude is working in another window. Following live.'
          : 'Read-only for now. Resuming sessions arrives in Phase 3.'}
      </footer>
    </div>
  );
}
