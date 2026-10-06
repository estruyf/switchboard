import { useEffect, useId, useRef, useState } from 'react';
import { useModalFocus } from '../ui/useModalFocus.ts';

/**
 * Write a commit message and commit. What is staged is committed; with nothing staged, every change
 * is. ⌘↵ commits, Esc cancels. `onCommit` rejects with git's message, which the dialog shows.
 */
export function CommitDialog({ branch, files, onCommit, onClose }: { branch: string | null; files: number; onCommit(message: string): Promise<void>; onClose(): void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useModalFocus(dialogRef);

  useEffect(() => {
    dialogRef.current?.querySelector('textarea')?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const commit = async () => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCommit(message.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="no-drag fixed inset-0 z-[60] flex items-center justify-center bg-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal aria-labelledby={`${id}-title`} className="w-[460px] max-w-[90vw] rounded-xl border overlay p-5" data-commit-dialog>
        <h2 id={`${id}-title`} className="text-[14px] font-semibold">
          Commit {files === 1 ? '1 file' : `${files} files`}
          {branch && <span className="font-normal text-muted"> on {branch}</span>}
        </h2>
        <p className="mt-1 text-[12px] text-muted">Commits what is staged, or every change when nothing is. Git runs in a terminal tab so you see the hooks’ output.</p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.metaKey) {
              e.preventDefault();
              void commit();
            }
          }}
          rows={4}
          spellCheck
          placeholder="Commit message"
          aria-label="Commit message"
          data-commit-message
          className="mt-3 block w-full resize-none rounded-md border border-border bg-bg px-2.5 py-2 text-[12.5px] text-text outline-none placeholder:text-faint focus:border-accent-ink"
        />
        {error && (
          <p role="alert" className="mt-2 text-[12px] break-words whitespace-pre-wrap text-error">
            That didn’t work: {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            data-confirm
            disabled={busy || !message.trim()}
            onClick={() => void commit()}
            className="flex h-7 items-center gap-2 rounded-md bg-accent px-3 text-ui font-semibold text-on-accent disabled:opacity-50"
          >
            {busy ? 'Committing…' : 'Commit'}
            {!busy && <kbd className="font-sans text-[11px] font-normal opacity-60">⌘↵</kbd>}
          </button>
        </div>
      </div>
    </div>
  );
}
