import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useModalFocus } from './ui/useModalFocus.ts';

export interface ConfirmDialogProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Shown instead of the confirm button when the action isn't possible right now. */
  blockedReason?: string | null;
  onConfirm(): Promise<void>;
  onClose(): void;
}

/** Modal confirmation for destructive actions. Enter confirms, Esc cancels. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useModalFocus(dialogRef);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onConfirm();
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="no-drag fixed inset-0 z-[60] flex items-center justify-center bg-scrim" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div ref={dialogRef} role="alertdialog" aria-modal aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`} className="w-[420px] max-w-[90vw] rounded-xl border overlay p-5">
        <h2 id={`${id}-title`} className="text-[14px] font-semibold">
          {props.title}
        </h2>
        <div id={`${id}-body`} className="mt-2 text-[12.5px] leading-relaxed text-muted">
          {props.body}
        </div>
        {(error || props.blockedReason) && (
          <p role="alert" className="mt-3 text-[12px] text-error">
            {error ? `That didn't work: ${error}` : props.blockedReason}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={props.onClose} className="btn-secondary">
            Cancel
          </button>
          {!props.blockedReason && (
            <button
              ref={confirmRef}
              type="button"
              data-confirm
              disabled={busy}
              onClick={() => void confirm()}
              className={`h-7 rounded-md px-3 text-ui font-semibold disabled:opacity-50 ${props.danger ? 'bg-error text-white' : 'bg-accent text-on-accent'}`}
            >
              {busy ? 'Working…' : props.confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
