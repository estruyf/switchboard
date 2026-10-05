import { create } from 'zustand';

const CHANGES_KEY = 'ui.changesPanel';
const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

/** Full-window overlays (search, command palette), side panels, and cross-component requests. */
interface OverlayState {
  /** `tools`: the current session's MCP servers, skills, agents and plugins. */
  open: 'search' | 'palette' | 'tools' | null;
  /** Set by search: the session view scrolls to this message and highlights it once. */
  focusMessage: { sessionId: string; messageUuid: string } | null;
  /** The Changes panel (⌘⇧D), remembered across launches. */
  changesOpen: boolean;
  /** The palette asks the session's actions bar to run an action (so confirm and trust prompts apply). */
  actionRequest: { id: string; nonce: number } | null;
  show(which: 'search' | 'palette' | 'tools'): void;
  close(): void;
  focus(target: { sessionId: string; messageUuid: string } | null): void;
  toggleChanges(open?: boolean): void;
  requestAction(id: string | null): void;
}

export const useOverlay = create<OverlayState>()((set) => ({
  open: null,
  focusMessage: null,
  changesOpen: readFlag(CHANGES_KEY),
  actionRequest: null,
  show: (open) => set({ open }),
  close: () => set({ open: null }),
  focus: (focusMessage) => set({ focusMessage }),
  toggleChanges: (open) =>
    set((s) => {
      const next = open ?? !s.changesOpen;
      try {
        localStorage.setItem(CHANGES_KEY, next ? '1' : '0');
      } catch {
        // Remembering is a convenience.
      }
      return { changesOpen: next };
    }),
  requestAction: (id) => set({ actionRequest: id ? { id, nonce: Date.now() } : null }),
}));
