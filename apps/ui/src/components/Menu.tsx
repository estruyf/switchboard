import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect(): void;
}
export type MenuEntry = MenuItem | 'separator' | { heading: string };

/** A small popup menu at a screen position (context menus and dropdowns). Closes on outside click or Esc. */
export function Menu({ x, y, entries, onClose, width = 220 }: { x: number; y: number; entries: MenuEntry[]; onClose(): void; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { innerWidth, innerHeight } = window;
    setPosition({ left: Math.min(x, innerWidth - el.offsetWidth - 8), top: Math.min(y, innerHeight - el.offsetHeight - 8) });
  }, [x, y]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: position.left, top: position.top, width }}
      className="no-drag fixed z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-xl"
    >
      {entries.map((entry, i) =>
        entry === 'separator' ? (
          <div key={i} className="my-1 border-t border-border" />
        ) : 'heading' in entry ? (
          <p key={i} className="px-3 pt-1.5 pb-0.5 text-[10px] tracking-wide text-faint uppercase">
            {entry.heading}
          </p>
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
            className={`flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] hover:bg-accent/15 disabled:opacity-40 ${entry.danger ? 'text-error' : 'text-text'}`}
          >
            {entry.icon && <span className="flex w-4 shrink-0 justify-center text-muted">{entry.icon}</span>}
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.hint && <span className="shrink-0 text-[11px] text-faint">{entry.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/** State helper: where a menu is open (or null). */
export function useMenu() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return {
    at,
    openAt: (x: number, y: number) => setAt({ x, y }),
    openBelow: (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      setAt({ x: rect.left, y: rect.bottom + 4 });
    },
    close: () => setAt(null),
  };
}
