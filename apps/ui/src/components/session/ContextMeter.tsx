import { useEffect, useId, useRef, useState } from 'react';
import type { ContextUsage, TranscriptMessage } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';

/** 46k, 1.2M. */
export const compactTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n));

/** Context at the end of the last turn, from the transcript (for sessions not running here). */
export function lastTurnTokens(messages: readonly TranscriptMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant' || m.parentToolUseId !== null || !m.usage) continue;
    const total = m.usage.input + m.usage.cacheRead + m.usage.cacheCreation + m.usage.output;
    if (total > 0) return total;
  }
  return null;
}

const PALETTE = ['#74c0fc', '#d0bfff', '#ffd43b', '#51cf66', '#ff922b', '#66d9ef', '#ed217c', '#a8b2c4'];
/** Claude Code may name its colours after its terminal theme; fall back to a palette then. */
const colorFor = (color: string, index: number) => (typeof CSS !== 'undefined' && CSS.supports('color', color) ? color : PALETTE[index % PALETTE.length]!);

function Ring({ percent }: { percent: number }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const tone = percent >= 90 ? 'var(--sb-error)' : percent >= 75 ? 'var(--sb-warn)' : 'var(--sb-accent-ink)';
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 -rotate-90" aria-hidden>
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--sb-border)" strokeWidth="2" />
      <circle cx="7" cy="7" r={r} fill="none" stroke={tone} strokeWidth="2" strokeLinecap="round" strokeDasharray={`${(Math.min(100, percent) / 100) * c} ${c}`} />
    </svg>
  );
}

/**
 * How full the context window is, like Claude Code's /context: a ring, "Context 42%" and used/total
 * tokens. For a session running here, click for the breakdown by category and to compact the
 * conversation (`onCompact`). Otherwise it shows what the last turn used, from the transcript.
 */
export function ContextMeter({
  sessionId,
  live,
  messages,
  onCompact,
}: {
  sessionId: string;
  live: { tokens: number; max: number; percent: number } | null;
  messages: readonly TranscriptMessage[];
  /** Sends /compact. */
  onCompact?: () => void;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [open, setOpen] = useState(false);
  const [breakdown, setBreakdown] = useState<ContextUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popupId = useId();

  useEffect(() => {
    if (!open || !client || !live) return;
    setError(null);
    client.call('session.context', { sessionId }).then(setBreakdown, (e: Error) => setError(e.message));
  }, [open, client, sessionId, live]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!live) {
    const tokens = lastTurnTokens(messages);
    if (tokens === null) return null;
    return (
      <span
        className="flex shrink-0 items-center gap-1 whitespace-nowrap tabular-nums"
        data-tooltip="Tokens in Claude’s context window (what it keeps in mind for this conversation) at the end of the last turn"
        data-context-meter
      >
        Context <span className="text-faint">≈{compactTokens(tokens)}</span>
        <span className="sr-only"> tokens</span>
      </span>
    );
  }

  const used = breakdown?.categories.filter((c) => c.kind === 'used' && c.tokens > 0) ?? [];
  return (
    <div ref={ref} className="relative" data-context-meter>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? popupId : undefined}
        // The ring and a bare percentage mean little on their own: say what they measure.
        aria-label={`Context window ${Math.round(live.percent)}% full, ${compactTokens(live.tokens)} of ${compactTokens(live.max)} tokens: show what fills it`}
        data-tooltip={`How full Claude’s context window is (what it keeps in mind for this conversation). Click for what fills it${onCompact ? ', and to compact it' : ''}.`}
        className={`flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 whitespace-nowrap tabular-nums hover:bg-border/50 hover:text-text ${live.percent >= 75 ? 'text-warn' : ''}`}
      >
        <Ring percent={live.percent} />
        Context {Math.round(live.percent)}%
        <span className="text-faint @max-[860px]:hidden">
          {compactTokens(live.tokens)} / {compactTokens(live.max)}
        </span>
      </button>
      {open && (
        <div id={popupId} role="dialog" aria-label="Context window" className="absolute right-0 bottom-full z-30 mb-1.5 w-72 rounded-lg border overlay p-3 text-[12px] text-text" data-context-breakdown>
          <p className="font-semibold">Context window</p>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {compactTokens(live.tokens)} of {compactTokens(live.max)} tokens ({Math.round(live.percent)}%){breakdown ? ` · ${breakdown.model}` : ''}
          </p>
          {error && <p className="mt-2 text-error">{error}</p>}
          {!breakdown && !error && <p className="mt-2 text-muted">Loading…</p>}
          {breakdown && (
            <>
              {/* One bar, each category its own colour, like /context. The list below says the same in words. */}
              <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-border" aria-hidden>
                {used.map((c, i) => (
                  <span key={c.name} style={{ width: `${(c.tokens / breakdown.maxTokens) * 100}%`, background: colorFor(c.color, i) }} data-tooltip={c.name} />
                ))}
              </div>
              <ul className="mt-2.5 grid gap-1">
                {used.map((c, i) => (
                  <li key={c.name} className="flex items-center gap-2">
                    <span className="size-2 shrink-0 rounded-sm" style={{ background: colorFor(c.color, i) }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-muted">{c.name}</span>
                    <span className="tabular-nums">{compactTokens(c.tokens)}</span>
                  </li>
                ))}
                <li className="flex items-center gap-2 border-t border-border pt-1">
                  <span className="size-2 shrink-0 rounded-sm bg-border" aria-hidden />
                  <span className="min-w-0 flex-1 text-muted">Free</span>
                  <span className="tabular-nums">{compactTokens(Math.max(0, breakdown.maxTokens - breakdown.totalTokens))}</span>
                </li>
              </ul>
            </>
          )}
          {onCompact && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCompact();
              }}
              data-compact
              className="mt-3 w-full rounded-md border border-border px-2 py-1 text-[12px] text-text hover:bg-border/50"
              data-tooltip="Sends /compact: Claude summarises the conversation so far to free up context"
            >
              Compact now
            </button>
          )}
        </div>
      )}
    </div>
  );
}
