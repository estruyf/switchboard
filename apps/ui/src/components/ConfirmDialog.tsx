import { useRef, useState, type ReactNode } from 'react';
import { Button } from './ui/Button.tsx';
import { Dialog } from './ui/Dialog.tsx';

export interface ConfirmDialogProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Shown instead of the confirm button when the action isn't possible right now. */
  blockedReason?: string | null;
  /** Next to Cancel: another way out that also does something (the quit prompt's Show unsent). Escape still only closes. */
  secondary?: { label: string; onSelect(): void; data?: Record<`data-${string}`, string | boolean> };
  onConfirm(): Promise<void>;
  onClose(): void;
}

/** Modal confirmation for destructive actions. Enter confirms (the confirm button has focus), Esc cancels. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

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
    <Dialog
      role="alertdialog"
      width="sm"
      title={props.title}
      subtitle={<div className="leading-relaxed">{props.body}</div>}
      onClose={props.onClose}
      initialFocus={confirmRef}
      footer={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          {props.secondary && (
            <Button onClick={props.secondary.onSelect} {...props.secondary.data}>
              {props.secondary.label}
            </Button>
          )}
          {!props.blockedReason && (
            <Button ref={confirmRef} variant={props.danger ? 'danger' : 'primary'} filled={props.danger} data-confirm disabled={busy} onClick={() => void confirm()}>
              {busy ? 'Working…' : props.confirmLabel}
            </Button>
          )}
        </>
      }
    >
      {(error || props.blockedReason) && (
        <p role="alert" className="text-ui text-error">
          {error ? `That didn't work: ${error}` : props.blockedReason}
        </p>
      )}
    </Dialog>
  );
}
