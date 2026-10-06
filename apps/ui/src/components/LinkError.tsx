import { Link2Off, X } from 'lucide-react';
import { useEffect } from 'react';
import { useLinks } from '../state/linksStore.ts';

/** Why a `switchboard://` link did nothing. Nothing else changed; it goes away on its own. */
export function LinkError() {
  const error = useLinks((s) => s.error);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => useLinks.getState().dismiss(), 8_000);
    return () => clearTimeout(timer);
  }, [error]);
  if (!error) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <div role="alert" data-link-error className="pointer-events-auto flex max-w-lg items-start gap-2.5 rounded-lg border border-error/40 bg-card px-3.5 py-2.5 text-[12.5px] shadow-lg">
        <Link2Off size={15} className="mt-px shrink-0 text-error" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">Couldn't open that link</p>
          <p className="break-words text-muted">{error.message}</p>
        </div>
        <button type="button" onClick={() => useLinks.getState().dismiss()} aria-label="Dismiss" className="-mr-1 shrink-0 rounded p-0.5 text-muted hover:bg-border/50 hover:text-text">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
