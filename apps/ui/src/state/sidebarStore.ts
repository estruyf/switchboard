import { useEffect } from 'react';
import { create } from 'zustand';
import { useEngineConnection } from '../engine/useEngine.ts';
import { clampSidebarWidth, SIDEBAR_DEFAULT_WIDTH } from './sidebarWidth.ts';

const SIDEBAR_KEY = 'ui.sidebar';

interface SidebarState {
  width: number;
  setWidth(width: number): void;
}

export const useSidebar = create<SidebarState>()((set) => ({
  width: SIDEBAR_DEFAULT_WIDTH,
  setWidth: (width) => set({ width: clampSidebarWidth(width) }),
}));

/** Restores the sidebar width from the engine's app state and saves it (debounced) when it changes. */
export function useSidebarSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const width = useSidebar((s) => s.width);

  useEffect(() => {
    if (!client) return;
    void client.call('appState.get', { key: SIDEBAR_KEY }).then(({ value }) => {
      const stored = value as { width?: unknown } | null;
      if (typeof stored?.width === 'number') useSidebar.getState().setWidth(stored.width);
    });
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const timer = setTimeout(() => void client.call('appState.set', { key: SIDEBAR_KEY, value: { width } }), 300);
    return () => clearTimeout(timer);
  }, [client, width]);
}
