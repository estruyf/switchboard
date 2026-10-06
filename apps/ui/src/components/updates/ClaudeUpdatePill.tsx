import { ArrowDownCircle, CheckCircle2, LoaderCircle, X } from 'lucide-react';
import { claudeUpdateNotice } from '../../lib/claudeUpdate.ts';
import { useClaudeUpdate } from '../../state/claudeUpdateStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';

const TONE = {
  accent: 'border-accent-ink/40 bg-accent/15 text-text hover:bg-accent/25',
  muted: 'border-border text-muted hover:bg-border/40',
  ok: 'border-ok/40 bg-ok/10 text-text',
} as const;

/** In the sidebar footer while a newer Claude Code is on offer, is being installed, or was just installed. */
export function ClaudeUpdatePill() {
  const state = useClaudeUpdate((s) => s.state);
  const notice = claudeUpdateNotice(state);
  if (!notice || !state) return null;

  const act = () => {
    // Updating shows its output in Settings → About, so go there too.
    useSessions.getState().openSettings('about');
    if (notice.action === 'update') useClaudeUpdate.getState().update();
  };
  const Icon = state.status === 'updating' ? LoaderCircle : state.status === 'updated' ? CheckCircle2 : ArrowDownCircle;

  return (
    <div className="flex min-w-0 items-center gap-0.5" data-claude-update-pill={state.status}>
      <button
        type="button"
        onClick={act}
        disabled={!notice.action}
        data-tooltip={notice.action === 'update' ? `Update with ${state.command}` : notice.action === 'about' ? 'Show in Settings' : undefined}
        className={`flex h-6 min-w-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium disabled:cursor-default ${TONE[notice.tone]}`}
      >
        <Icon size={12} aria-hidden className={`shrink-0 ${state.status === 'updating' ? 'animate-spin' : state.status === 'updated' ? 'text-ok' : 'text-accent-ink'}`} />
        <span className="truncate">{notice.label}</span>
      </button>
      {notice.dismissible && (
        <button
          type="button"
          onClick={() => useClaudeUpdate.getState().dismiss()}
          data-claude-update-dismiss
          data-tooltip="Dismiss"
          aria-label="Dismiss Claude Code update"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-border/60 hover:text-text"
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}
