import { create } from 'zustand';
import type { ImageAttachment } from '@switchboard/protocol/client';
import { DRAFT_SETTLE_MS, isCountingDraft, nextDraft, type Draft, type DraftForm } from './drafts.ts';

export type ComposerDraft = Draft<ImageAttachment>;

/** Sessions about to be archived while one of them holds an unsent message: the dialog asks first. */
export interface ArchivePrompt {
  titles: string[];
  ids: string[];
  archive(): void;
}

interface DraftsState {
  /** By session id, or `new:<project folder>` for New session (see `newDraftKey`). */
  drafts: Record<string, ComposerDraft>;
  /** The saved drafts have been read (or there were none to read). */
  loaded: boolean;
  /** A message box should take focus with the caret at the end of its text (opened from the Unsent list or ⌘P). */
  focus: { key: string; nonce: number } | null;
  /** The Unsent messages popover: where it opens (its bottom-left corner when `above`). */
  list: { x: number; y: number; above: boolean } | null;
  archivePrompt: ArchivePrompt | null;
  /** The message box changed: keeps it (or forgets an empty one). */
  setDraft(key: string, draft: { text: string; attachments: ImageAttachment[] }): void;
  /** Puts text in a box for you (Edit and resend): it shows no "kept for you" line. */
  seedDraft(key: string, text: string): void;
  /** New session's choices for the prompt under `key`, kept with it while there is one. */
  setForm(key: string, form: DraftForm): void;
  removeDraft(key: string): void;
  removeDrafts(keys: readonly string[]): void;
  /** A New session prompt follows the project it moves to. */
  moveDraft(from: string, to: string): void;
  /** Drafts read back after a restart; anything typed meanwhile wins. */
  load(drafts: Record<string, ComposerDraft>): void;
  requestFocus(key: string): void;
  clearFocus(): void;
  openList(at: { x: number; y: number; above: boolean }): void;
  closeList(): void;
  /** Archives right away, or first asks when one of the sessions holds an unsent message. */
  requestArchive(prompt: ArchivePrompt, needsAsking: boolean): void;
  closeArchivePrompt(): void;
}

/** One timer per draft: when it fires and the draft hasn't changed since, it counts. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const cancelTimer = (key: string) => {
  clearTimeout(timers.get(key));
  timers.delete(key);
};
let focusRequests = 0;

const without = (drafts: Record<string, ComposerDraft>, keys: readonly string[]) => {
  const next = { ...drafts };
  for (const key of keys) {
    cancelTimer(key);
    delete next[key];
  }
  return next;
};

export const useDrafts = create<DraftsState>()((set, get) => {
  const settleLater = (key: string, draft: ComposerDraft) => {
    cancelTimer(key);
    if (draft.counted) return;
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        const current = get().drafts[key];
        if (current === draft && isCountingDraft(current, Date.now())) set((s) => ({ drafts: { ...s.drafts, [key]: { ...current, counted: true } } }));
      }, DRAFT_SETTLE_MS),
    );
  };

  return {
    drafts: {},
    loaded: false,
    focus: null,
    list: null,
    archivePrompt: null,
    setDraft: (key, value) => {
      const previous = get().drafts[key];
      const draft = nextDraft(previous, value, Date.now());
      if (draft === previous) return;
      if (!draft) {
        if (previous) set((s) => ({ drafts: without(s.drafts, [key]) }));
        return;
      }
      set((s) => ({ drafts: { ...s.drafts, [key]: draft } }));
      settleLater(key, draft);
    },
    seedDraft: (key, text) => {
      const draft: ComposerDraft = { text, attachments: [], updatedAt: Date.now(), counted: false, lostImages: 0, seeded: true };
      set((s) => ({ drafts: { ...s.drafts, [key]: draft } }));
      settleLater(key, draft);
    },
    setForm: (key, form) => {
      const draft = get().drafts[key];
      if (!draft || JSON.stringify(draft.form) === JSON.stringify(form)) return;
      // Same draft otherwise: a timer waiting on it still recognises it.
      const next = { ...draft, form };
      set((s) => ({ drafts: { ...s.drafts, [key]: next } }));
      if (!next.counted) settleLater(key, next);
    },
    removeDraft: (key) => get().removeDrafts([key]),
    removeDrafts: (keys) => {
      if (keys.some((key) => key in get().drafts)) set((s) => ({ drafts: without(s.drafts, keys) }));
    },
    moveDraft: (from, to) => {
      const draft = get().drafts[from];
      if (!draft || from === to) return;
      // The choices were the old project's; the new one starts from its own.
      const moved: ComposerDraft = { ...draft, form: undefined };
      set((s) => ({ drafts: { ...without(s.drafts, [from]), [to]: moved } }));
      settleLater(to, moved);
    },
    load: (drafts) => set((s) => ({ drafts: { ...drafts, ...s.drafts }, loaded: true })),
    requestFocus: (key) => set({ focus: { key, nonce: ++focusRequests } }),
    clearFocus: () => set({ focus: null }),
    openList: (list) => set({ list }),
    closeList: () => set({ list: null }),
    requestArchive: (prompt, needsAsking) => (needsAsking ? set({ archivePrompt: prompt }) : prompt.archive()),
    closeArchivePrompt: () => set({ archivePrompt: null }),
  };
});
