import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a confirmation such as "Action saved" stays. */
export const FLASH_MS = 2_500;

/** A short confirmation that clears itself: `flash('Action saved')` shows it, a later flash replaces it. */
export function useFlash(ms = FLASH_MS): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(
    (next: string) => {
      clearTimeout(timer.current);
      setMessage(next);
      timer.current = setTimeout(() => setMessage(null), ms);
    },
    [ms],
  );
  return [message, flash];
}
