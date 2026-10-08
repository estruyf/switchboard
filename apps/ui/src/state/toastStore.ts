import { create } from 'zustand';

/**
 * A minimal toast: a short line in the window's corner, with an optional Undo, that goes away by itself.
 * Only what the Later list needs; #14 (toasts with Undo everywhere) can replace it with its own API.
 */
export interface Toast {
  id: number;
  message: string;
  /** A small icon before the message (saved for later). */
  icon?: 'bookmark';
  /** A coloured dot before the message instead (a theme's accent); a validated colour value. */
  dot?: string;
  /** A one-click way back, for about five seconds. */
  undo?: () => void;
}

/** How long a toast stays while visible (the timer pauses on hover and while the window is in the background). */
export const TOAST_MS = 5_000;

interface ToastState {
  toasts: Toast[];
  show(toast: Omit<Toast, 'id'>): number;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  show: (toast) => {
    const id = nextId++;
    // Newest last; three at most, so a burst of quick actions doesn't fill the window.
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }].slice(-3) }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Shows a toast; returns its id. */
export const toast = (message: string, options: Pick<Toast, 'undo' | 'icon' | 'dot'> = {}) => useToasts.getState().show({ message, ...options });
