import { useEffect, useState, type RefObject } from 'react';

// Elements taken out of the Tab order (tabindex="-1", such as rows driven by arrow keys) don't count.
const FOCUSABLE = ['button:not(:disabled)', '[href]', 'input:not(:disabled)', 'textarea:not(:disabled)', 'select:not(:disabled)', '[tabindex]', '[contenteditable="true"]'].map((s) => `${s}:not([tabindex="-1"])`).join(', ');

/** Open modals, innermost last: only the top one traps Tab. */
const stack: HTMLElement[] = [];

/** Whether `root` is the modal on top, the one keys such as Escape belong to. */
export const isTopModal = (root: HTMLElement | null) => root !== null && stack[stack.length - 1] === root;

/** The elements Tab can reach inside `root`, in document order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[inert], [aria-hidden="true"]') && el.getClientRects().length > 0);
}

/**
 * Focus handling for a modal dialog: Tab and ⇧Tab stay inside it, and when it closes focus goes back
 * to whatever had it before (the button that opened it), so keyboard and VoiceOver users don't land
 * at the top of the window. The dialog keeps choosing its own first focus (a field or default button);
 * if it doesn't, the first control inside gets it.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>) {
  // Read during the first render, before the dialog's own effects move focus into it.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (!root.contains(document.activeElement)) (focusableIn(root)[0] ?? root).focus();

    stack.push(root);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented || stack[stack.length - 1] !== root) return;
      const items = focusableIn(root);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement as HTMLElement | null;
      if (!current || !root.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(root), 1);
      // Only hand focus back when nothing else claimed it (another dialog, or a click elsewhere).
      const active = document.activeElement;
      if (opener?.isConnected && (!active || active === document.body || root.contains(active))) opener.focus();
    };
  }, [ref, opener]);
}
