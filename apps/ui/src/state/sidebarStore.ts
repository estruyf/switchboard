import { useEffect } from 'react';
import { create } from 'zustand';
import { useEngineConnection } from '../engine/useEngine.ts';
import { usePreferences } from './preferencesStore.ts';
import { clampSidebarWidth, parseSidebarState, SIDEBAR_DEFAULT_WIDTH, toggledState, type SidebarState } from './sidebarWidth.ts';

const SIDEBAR_KEY = 'ui.sidebar';

interface SidebarStore {
  /** The open width: kept while the sidebar is minimal or closed, so opening it again restores it. */
  width: number;
  state: SidebarState;
  setWidth(width: number): void;
  setState(state: SidebarState): void;
  /** ⌘B: open goes to what "When collapsed" says in Settings, minimal or closed opens. */
  toggle(): void;
}

export const useSidebar = create<SidebarStore>()((set) => ({
  width: SIDEBAR_DEFAULT_WIDTH,
  state: 'open',
  setWidth: (width) => set({ width: clampSidebarWidth(width) }),
  setState: (state) => set({ state }),
  toggle: () => set((s) => ({ state: toggledState(s.state, usePreferences.getState().prefs.sidebarCollapsed) })),
}));

/** Restores the sidebar's width and state from the engine's app state and saves them (debounced) when they change. */
export function useSidebarSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const width = useSidebar((s) => s.width);
  const state = useSidebar((s) => s.state);

  useEffect(() => {
    if (!client) return;
    void client.call('appState.get', { key: SIDEBAR_KEY }).then(({ value }) => {
      const stored = value as { width?: unknown; state?: unknown } | null;
      if (typeof stored?.width === 'number') useSidebar.getState().setWidth(stored.width);
      if (stored && 'state' in stored) useSidebar.getState().setState(parseSidebarState(stored.state));
    });
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const timer = setTimeout(() => void client.call('appState.set', { key: SIDEBAR_KEY, value: { width, state } }), 300);
    return () => clearTimeout(timer);
  }, [client, width, state]);

  // The traffic lights move into the rail while it shows, and back for the open sidebar and the headers.
  useEffect(() => window.switchboard?.setWindowButtons?.(state === 'minimal' ? 'rail' : 'default'), [state]);
}
