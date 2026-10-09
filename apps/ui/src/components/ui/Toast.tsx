import { ListEnd, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { TOAST_MS, useToasts, type Toast } from '../../state/toastStore.ts';
import { Button } from './Button.tsx';

/** One toast: it counts down while visible, pauses while the pointer is on it or the window is in the background. */
function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = () => useToasts.getState().dismiss(toast.id);
  const [hovered, setHovered] = useState(false);
  const [windowFocused, setWindowFocused] = useState(() => document.hasFocus());
  const left = useRef(toast.durationMs ?? TOAST_MS);

  useEffect(() => {
    const on = () => setWindowFocused(true);
    const off = () => setWindowFocused(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
    };
  }, []);

  const running = !hovered && windowFocused;
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setTimeout(dismiss, left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - started));
    };
  }, [running]);

  const lead = (
    <>
      {toast.icon === 'queue' && <ListEnd size={14} className="shrink-0 text-muted" aria-hidden />}
      {toast.dot && <span className="size-2 shrink-0 rounded-full" style={{ background: toast.dot }} aria-hidden />}
      {toast.tone === 'ok' && <span className="size-2 shrink-0 rounded-full bg-ok" aria-hidden />}
    </>
  );
  const close = <Button variant="quiet" size="sm" iconOnly icon={<X size={13} aria-hidden />} aria-label="Dismiss" onClick={dismiss} className="shrink-0" />;
  const card = !!toast.body || !!toast.actions?.length;

  return (
    <div
      role="status"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // A focused toast takes Escape itself, so it never reaches the message box (which would stop Claude).
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }}
      className={`pointer-events-auto flex w-[360px] max-w-[calc(100vw-32px)] rounded-xl border overlay text-ui text-text ${card ? 'flex-col gap-1.5 py-2.5 pr-2 pl-3.5' : 'min-h-11 items-center gap-2.5 py-1.5 pr-1.5 pl-3.5'}`}
      data-toast
      {...toast.data}
    >
      {card ? (
        <>
          <div className="flex min-w-0 items-center gap-2.5">
            {lead}
            <span className="min-w-0 flex-1 truncate font-semibold">{toast.message}</span>
            {close}
          </div>
          {toast.body && <p className="pr-2 text-ui text-muted">{toast.body}</p>}
          {toast.actions?.length ? (
            <div className="mt-1 flex items-center gap-2">
              {toast.actions.map((action) => (
                <Button
                  key={action.label}
                  variant={action.primary ? 'primary' : 'secondary'}
                  onClick={() => {
                    dismiss();
                    action.onSelect();
                  }}
                  {...action.data}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {lead}
          <span className="min-w-0 flex-1 truncate">{toast.message}</span>
          {toast.undo && (
            // In the link colour, like the sidebar's Select all: the one thing to do with a toast.
            <button
              type="button"
              onClick={() => {
                toast.undo?.();
                dismiss();
              }}
              className="shrink-0 rounded px-1.5 text-ui font-semibold text-link hover:underline"
              data-toast-undo
            >
              Undo
            </button>
          )}
          {close}
        </>
      )}
    </div>
  );
}

/** The toasts, bottom right, newest at the bottom. */
export function ToastLayer() {
  const toasts = useToasts((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="no-drag pointer-events-none fixed right-4 bottom-4 z-[70] flex flex-col items-end gap-2" data-toasts>
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}
