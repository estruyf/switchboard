import { useEffect } from 'react';
import { create } from 'zustand';
import type { TerminalInfo, TerminalKind } from '@switchboard/protocol/client';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';

const PANEL_KEY = 'ui.terminalPanel';

/** Why a terminal didn't open, shown in the panel. `code` is the engine's (e.g. SESSION_RUNNING_HERE), so the panel can offer a way out. */
export interface TerminalNotice {
  code: string | null;
  message: string;
}

interface TerminalsState {
  terminals: Map<string, TerminalInfo>;
  /** The engine's list has arrived, so "no terminals" really means none. */
  loaded: boolean;
  panelOpen: boolean;
  /** The user just opened the panel (Terminal button, ⌘J): it starts a shell when the session has none. */
  shellWanted: boolean;
  panelHeight: number;
  /** Selected tab per session. */
  active: Map<string, string>;
  /** Per session. */
  notices: Map<string, TerminalNotice>;
  setTerminals(list: TerminalInfo[]): void;
  /** No argument: the user toggles it, and opening asks for a shell. `true`/`false`: show or hide what's there (an action's tab, a restored state). */
  togglePanel(open?: boolean): void;
  setShellWanted(wanted: boolean): void;
  setNotice(sessionId: string, notice: TerminalNotice | null): void;
  setPanelHeight(height: number): void;
  setActive(sessionId: string, terminalId: string): void;
}

export const useTerminals = create<TerminalsState>()((set) => ({
  terminals: new Map(),
  loaded: false,
  panelOpen: false,
  shellWanted: false,
  panelHeight: 280,
  active: new Map(),
  notices: new Map(),
  setTerminals: (list) => set({ terminals: new Map(list.map((t) => [t.id, t])), loaded: true }),
  togglePanel: (open) => set((s) => (open === undefined ? { panelOpen: !s.panelOpen, shellWanted: !s.panelOpen } : { panelOpen: open })),
  setShellWanted: (shellWanted) => set({ shellWanted }),
  setNotice: (sessionId, notice) =>
    set((s) => {
      const notices = new Map(s.notices);
      if (notice) notices.set(sessionId, notice);
      else notices.delete(sessionId);
      return { notices };
    }),
  setPanelHeight: (panelHeight) => set({ panelHeight: Math.round(Math.min(Math.max(panelHeight, 120), window.innerHeight * 0.75)) }),
  setActive: (sessionId, terminalId) => set((s) => ({ active: new Map(s.active).set(sessionId, terminalId) })),
}));

/**
 * Opens a terminal tab for a session and shows it. When it can't (the session runs here or in another
 * Claude Code), the reason goes to the panel, which offers to stop it or open a fork.
 */
export async function openTerminal(client: EngineClient, sessionId: string, cwd: string, kind: TerminalKind, fork = false): Promise<void> {
  const state = useTerminals.getState();
  state.setNotice(sessionId, null);
  state.togglePanel(true);
  try {
    const info = await client.call('terminal.open', { sessionId, cwd, kind, cols: 100, rows: 20, fork });
    useTerminals.getState().setActive(sessionId, info.id);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    const message = e instanceof Error ? e.message : String(e);
    const blocked = code === 'SESSION_RUNNING_HERE' || code === 'SESSION_BUSY_ELSEWHERE';
    useTerminals.getState().setNotice(sessionId, blocked ? { code, message } : { code: null, message: `Couldn't open the terminal: ${message}` });
  }
}

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
