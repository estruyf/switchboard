import { create } from 'zustand';
import { openProject } from './projectPageStore.ts';
import { useOverlay } from './overlayStore.ts';
import { useSessions } from './sessionsStore.ts';

interface MemoryViewState {
  /** The file the Memory tab selects next time it shows this project (a memory just saved, the palette's pick). */
  focus: { root: string; path: string; nonce: number } | null;
  /** A file the Changes panel opens and scrolls to once it lists it (Show in Changes after a share). */
  changesFocus: { path: string; nonce: number } | null;
}

let nonce = 0;

export const useMemoryView = create<MemoryViewState>()(() => ({ focus: null, changesFocus: null }));

/** Opens a project's Memory tab on one file. */
export function openMemoryFile(root: string, path: string): void {
  useMemoryView.setState({ focus: { root, path, nonce: ++nonce } });
  openProject(root, 'memory');
}

/**
 * The newest session working in the project's own checkout (not a worktree), whose Changes panel shows a file there;
 * null when there is none.
 */
export function changesSessionFor(root: string): string | null {
  let best: { id: string; at: number } | null = null;
  for (const s of useSessions.getState().sessions.values()) {
    if (s.projectRoot !== root || s.cwd !== root || s.worktree) continue;
    if (!best || s.updatedAt > best.at) best = { id: s.id, at: s.updatedAt };
  }
  return best?.id ?? null;
}

/** Shows a file of the project in the Changes panel of its newest session. False when the project has no session to show it in. */
export function showInChanges(root: string, path: string): boolean {
  const sessionId = changesSessionFor(root);
  if (!sessionId) return false;
  useSessions.getState().select(sessionId);
  useOverlay.getState().toggleChanges(true);
  useMemoryView.setState({ changesFocus: { path: path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path, nonce: ++nonce } });
  return true;
}
