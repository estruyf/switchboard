import { create } from 'zustand';
import { isNewDraftKey } from './drafts.ts';

/** A message box on screen, by its draft key (a session's id, or New session's `new:<folder>`), and its folder. */
export interface ComposerTarget {
  key: string;
  cwd: string | null;
}

interface ComposerTargetsState {
  /** The message boxes mounted now, with when each last had focus (or mounted). */
  boxes: Record<string, ComposerTarget & { at: number }>;
  /** The Add context picker is open for this box. */
  picker: ComposerTarget | null;
  register(target: ComposerTarget): void;
  unregister(key: string): void;
  openPicker(target: ComposerTarget): void;
  closePicker(): void;
}

let clock = 0;

/** Where context added from outside the box goes (the palette's Add context…, the picker). */
export const useComposerTargets = create<ComposerTargetsState>()((set) => ({
  boxes: {},
  picker: null,
  register: (target) => set((s) => ({ boxes: { ...s.boxes, [target.key]: { ...target, at: ++clock } } })),
  unregister: (key) =>
    set((s) => {
      if (!(key in s.boxes)) return {};
      const boxes = { ...s.boxes };
      delete boxes[key];
      return { boxes };
    }),
  openPicker: (picker) => set({ picker }),
  closePicker: () => set({ picker: null }),
}));

/**
 * The message box the palette's Add context… adds to: the session's in the active pane, or New session's. Null when
 * neither is on screen or its folder isn't known yet.
 */
export function activeComposer(boxes: ComposerTargetsState['boxes'], view: 'session' | 'new' | 'other', selectedId: string | null): { key: string; cwd: string } | null {
  const pick = (box: (ComposerTarget & { at: number }) | undefined) => (box?.cwd ? { key: box.key, cwd: box.cwd } : null);
  if (view === 'session') return selectedId ? pick(boxes[selectedId]) : null;
  if (view === 'new') return pick(Object.values(boxes).filter((b) => isNewDraftKey(b.key)).sort((a, b) => b.at - a.at)[0]);
  return null;
}
