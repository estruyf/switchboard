import { useState, type ReactNode } from 'react';
import { Popover } from './ui/Popover.tsx';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect(): void;
}
export type MenuEntry = MenuItem | 'separator' | { heading: string };

/** A small popup menu at a screen position (context menus and dropdowns). Closes on outside click or Esc. `above` puts its bottom edge at y. */
export function Menu({ x, y, entries, onClose, width = 220, above = false }: { x: number; y: number; entries: MenuEntry[]; onClose(): void; width?: number; above?: boolean }) {
  return (
    <Popover x={x} y={y} width={width} above={above} onClose={onClose} role="menu">
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
    </Popover>
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
    /** For `<Menu above>`: anchors the menu's bottom edge just above the element. */
    openAbove: (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      setAt({ x: rect.left, y: rect.top - 4 });
    },
    close: () => setAt(null),
  };
}
