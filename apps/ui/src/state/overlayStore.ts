import { create } from 'zustand';

const CHANGES_KEY = 'ui.changesPanel';
const WRAP_KEY = 'ui.diffWrap';
const writeFlag = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Remembering is a convenience.
  }
};
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
  /** Wrap long lines in diffs instead of scrolling sideways, remembered across launches. */
  diffWrap: boolean;
  /** The palette asks the session's actions bar to run an action (so confirm and trust prompts apply). */
  actionRequest: { id: string; nonce: number } | null;
  show(which: 'search' | 'palette' | 'tools'): void;
  close(): void;
  focus(target: { sessionId: string; messageUuid: string } | null): void;
  toggleChanges(open?: boolean): void;
  toggleDiffWrap(): void;
  requestAction(id: string | null): void;
}

export const useOverlay = create<OverlayState>()((set) => ({
  open: null,
  focusMessage: null,
  changesOpen: readFlag(CHANGES_KEY),
  diffWrap: readFlag(WRAP_KEY),
  actionRequest: null,
  show: (open) => set({ open }),
  close: () => set({ open: null }),
  focus: (focusMessage) => set({ focusMessage }),
  toggleChanges: (open) =>
    set((s) => {
      const next = open ?? !s.changesOpen;
      writeFlag(CHANGES_KEY, next);
      return { changesOpen: next };
    }),
  toggleDiffWrap: () =>
    set((s) => {
      writeFlag(WRAP_KEY, !s.diffWrap);
      return { diffWrap: !s.diffWrap };
    }),
  requestAction: (id) => set({ actionRequest: id ? { id, nonce: Date.now() } : null }),
}));
