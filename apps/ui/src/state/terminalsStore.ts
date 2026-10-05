import { useEffect } from 'react';
import { create } from 'zustand';
import type { TerminalInfo } from '@switchboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';

const PANEL_KEY = 'ui.terminalPanel';

interface TerminalsState {
  terminals: Map<string, TerminalInfo>;
  panelOpen: boolean;
  panelHeight: number;
  /** Selected tab per session. */
  active: Map<string, string>;
  setTerminals(list: TerminalInfo[]): void;
  togglePanel(open?: boolean): void;
  setPanelHeight(height: number): void;
  setActive(sessionId: string, terminalId: string): void;
}

export const useTerminals = create<TerminalsState>()((set) => ({
  terminals: new Map(),
  panelOpen: false,
  panelHeight: 280,
  active: new Map(),
  setTerminals: (list) => set({ terminals: new Map(list.map((t) => [t.id, t])) }),
  togglePanel: (open) => set((s) => ({ panelOpen: open ?? !s.panelOpen })),
  setPanelHeight: (panelHeight) => set({ panelHeight: Math.round(Math.min(Math.max(panelHeight, 120), window.innerHeight * 0.75)) }),
  setActive: (sessionId, terminalId) => set((s) => ({ active: new Map(s.active).set(sessionId, terminalId) })),
}));

/** Keeps the terminal list current and remembers the panel's open state and height. */
export function useTerminalsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const panelOpen = useTerminals((s) => s.panelOpen);
  const panelHeight = useTerminals((s) => s.panelHeight);

  useEffect(() => {
    if (!client) return;
    const off = client.on('terminals.changed', ({ terminals }) => useTerminals.getState().setTerminals(terminals));
    void client.call('terminal.list', {}).then(({ terminals }) => useTerminals.getState().setTerminals(terminals));
    void client.call('appState.get', { key: PANEL_KEY }).then(({ value }) => {
      const stored = value as { open?: unknown; height?: unknown } | null;
      if (typeof stored?.height === 'number') useTerminals.getState().setPanelHeight(stored.height);
      if (typeof stored?.open === 'boolean') useTerminals.getState().togglePanel(stored.open);
    });
    return off;
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const timer = setTimeout(() => void client.call('appState.set', { key: PANEL_KEY, value: { open: panelOpen, height: panelHeight } }), 300);
    return () => clearTimeout(timer);
  }, [client, panelOpen, panelHeight]);
}
