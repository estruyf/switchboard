import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from 'react';

export interface PopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style'> {
  x: number;
  y: number;
  width?: number;
  /** Puts the popover's bottom edge at y instead of its top edge. */
  above?: boolean;
  onClose(): void;
  /** Close on Escape from anywhere (menus). A Select handles Escape itself so it never reaches other listeners. */
  closeOnEscape?: boolean;
  /** Clicks on this element don't count as outside clicks (the button that toggles the popover). */
  anchor?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * A floating panel at a screen position, kept on screen. Closes on an outside click, when the window
 * loses focus and (optionally) on Escape. The shared base for `Menu` and `Select`.
 */
export function Popover({ x, y, width, above = false, onClose, closeOnEscape = true, anchor, className = '', children, ...rest }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the popover on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { innerWidth, innerHeight } = window;
    const top = above ? y - el.offsetHeight : y;
    setPosition({ left: Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8)), top: Math.max(8, Math.min(top, innerHeight - el.offsetHeight - 8)) });
  }, [x, y, above]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor?.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => closeOnEscape && event.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose, closeOnEscape, anchor]);

  return (
    <div
      ref={ref}
      {...rest}
      style={{ left: position.left, top: position.top, width }}
      className={`no-drag fixed z-50 max-h-[70vh] overflow-y-auto rounded-lg border overlay py-1 ${className}`}
    >
      {children}
    </div>
  );
}
