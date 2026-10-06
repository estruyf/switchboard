import { ArrowDownCircle, FileText, LoaderCircle, RotateCw, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { updatePill } from '../../lib/updates.ts';
import { useUpdates } from '../../state/updatesStore.ts';
import { Button } from '../ui/Button.tsx';
import { Popover } from '../ui/Popover.tsx';
import { useInstallUpdate } from './useInstallUpdate.tsx';

const TONE = {
  accent: 'border-accent-ink/40 bg-accent/15 text-text hover:bg-accent/25',
  muted: 'border-border text-muted',
  error: 'border-error/40 bg-error/10 text-error hover:bg-error/15',
  ok: 'border-ok/40 bg-ok/10 text-text',
} as const;

/** The release notes of the update on offer, read in a popover above the pill. */
function NotesButton({ version, notes }: { version: string; notes: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={anchor}
        variant="quiet"
        size="sm"
        iconOnly
        icon={<FileText size={13} aria-hidden />}
        data-update-notes-toggle
        onClick={(e) => {
          if (at) return setAt(null);
          const rect = e.currentTarget.getBoundingClientRect();
          setAt({ x: rect.left - 8, y: rect.top - 6 });
        }}
        data-tooltip="What’s new"
        aria-label={`What’s new in v${version}`}
        className="shrink-0"
      />
      {at && (
        <Popover x={at.x} y={at.y} above width={340} anchor={anchor} onClose={() => setAt(null)} role="dialog" aria-label={`What’s new in v${version}`} data-update-notes>
          <div className="px-3 py-2">
            <p className="text-[12px] font-semibold">What’s new in v{version}</p>
            <p className="mt-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-muted">{notes}</p>
          </div>
        </Popover>
      )}
    </>
  );
}

/** In the sidebar footer while an update is on offer, downloading, ready, failed or just installed. */
export function UpdatePillButton() {
  const state = useUpdates((s) => s.state);
  const { install, dialog } = useInstallUpdate();
  const pill = updatePill(state);
  if (!pill || !state) return dialog;

  const act = () => {
    if (pill.action === 'install') install();
    else if (pill.action) window.switchboard?.update(pill.action);
  };
  const Icon = state.status === 'downloading' || state.status === 'installing' ? LoaderCircle : pill.action === 'retry' ? RotateCw : ArrowDownCircle;
  const notesVersion = state.downloadedVersion ?? state.availableVersion;

  return (
    <div className="flex min-w-0 items-center gap-0.5" data-update-pill={state.status}>
      <button
        type="button"
        onClick={act}
        disabled={!pill.action}
        data-tooltip={pill.action === 'retry' ? (state.error ?? undefined) : undefined}
        className={`flex h-6 min-w-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium disabled:cursor-default ${TONE[pill.tone]}`}
      >
        {pill.action !== 'dismiss' && <Icon size={12} aria-hidden className={`shrink-0 ${pill.tone === 'error' ? 'text-error' : pill.action ? 'text-accent-ink' : 'animate-spin'}`} />}
        <span className="truncate">{pill.label}</span>
        {pill.action === 'retry' && <span className="shrink-0 underline">Retry</span>}
        {pill.action === 'dismiss' && (
          <>
            <X size={11} className="shrink-0 text-muted" aria-hidden />
            <span className="sr-only">, dismiss</span>
          </>
        )}
      </button>
      {notesVersion && state.releaseNotes && pill.action !== 'dismiss' && <NotesButton version={notesVersion} notes={state.releaseNotes} />}
      {dialog}
    </div>
  );
}
