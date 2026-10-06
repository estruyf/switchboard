import { Link2Off, X } from 'lucide-react';
import { useEffect } from 'react';
import { useLinks } from '../state/linksStore.ts';
import { Button } from './ui/Button.tsx';

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
        <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} onClick={() => useLinks.getState().dismiss()} aria-label="Dismiss" className="-my-0.5 -mr-1.5 shrink-0" />
      </div>
    </div>
  );
}
