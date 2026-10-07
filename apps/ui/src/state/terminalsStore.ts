import { useEffect } from 'react';
import { create } from 'zustand';
import type { TerminalInfo, TerminalKind } from '@switchboard/protocol/client';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { clampPanelHeight, clampPanelWidth, PANEL_DEFAULT_HEIGHT, PANEL_DEFAULT_WIDTH, parseDock, type TerminalDock } from '../components/terminal/terminalLayout.ts';
import { trackRuns, type RunTimes } from '../components/terminal/terminalStatus.ts';
import { passFocusGate } from './focusGate.ts';

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
  /** Docked below: its height. */
  panelHeight: number;
  /** Docked right: its width. */
  panelWidth: number;
  /** Where the user wants the panel. It still docks below while the Changes panel is on the right (`effectiveDock`). */
  dock: TerminalDock;
  /** The panel takes the whole session view, hiding the conversation (⌘⇧J; Esc or ⌘⇧J restores it). */
  maximized: boolean;
  /** When each terminal's current run started and ended, for the run strip's elapsed time. */
  runs: Map<string, RunTimes>;
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
  setPanelWidth(width: number): void;
  setDock(dock: TerminalDock): void;
  /** No argument: toggle. */
  setMaximized(maximized?: boolean): void;
  setActive(sessionId: string, terminalId: string): void;
}

export const useTerminals = create<TerminalsState>()((set) => ({
  terminals: new Map(),
  loaded: false,
  panelOpen: false,
  shellWanted: false,
  panelHeight: PANEL_DEFAULT_HEIGHT,
  panelWidth: PANEL_DEFAULT_WIDTH,
  dock: 'bottom',
  maximized: false,
  runs: new Map(),
  active: new Map(),
  notices: new Map(),
  setTerminals: (list) => set((s) => ({ terminals: new Map(list.map((t) => [t.id, t])), runs: trackRuns(s.runs, s.terminals, list, Date.now()), loaded: true })),
  // Hiding the panel also ends a maximized view, so the conversation is back the next time.
  togglePanel: (open) =>
    set((s) => {
      const next = open ?? !s.panelOpen;
      return { panelOpen: next, ...(open === undefined ? { shellWanted: next } : {}), ...(next ? {} : { maximized: false }) };
    }),
  setShellWanted: (shellWanted) => set({ shellWanted }),
  setNotice: (sessionId, notice) =>
    set((s) => {
      const notices = new Map(s.notices);
      if (notice) notices.set(sessionId, notice);
      else notices.delete(sessionId);
      return { notices };
    }),
  setPanelHeight: (height) => set({ panelHeight: clampPanelHeight(height, window.innerHeight) }),
  setPanelWidth: (width) => set({ panelWidth: clampPanelWidth(width, window.innerWidth) }),
  setDock: (dock) => set({ dock }),
  setMaximized: (maximized) => set((s) => ({ maximized: maximized ?? !s.maximized })),
  setActive: (sessionId, terminalId) => set((s) => ({ active: new Map(s.active).set(sessionId, terminalId) })),
}));

/**
 * Opens a terminal tab for a session and shows it. When it can't (the session runs here or in another
 * Claude Code), the reason goes to the panel, which offers to stop it or open a fork.
 */
export async function openTerminal(client: EngineClient, sessionId: string, cwd: string, kind: TerminalKind, fork = false): Promise<void> {
  // Claude in the terminal starts work too: the focus limit's gate, as for a message (a fork is a new session).
  if (kind === 'claude' && (await passFocusGate({ target: fork ? null : sessionId })) !== 'start') return;
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

/**
 * Resolves once the terminal has exited (or is gone), or after `timeoutMs`. Restart on a running action
 * stops it first, and the engine only restarts a terminal that has exited.
 */
export function waitForExit(id: string, timeoutMs: number): Promise<boolean> {
  const exited = () => {
    const t = useTerminals.getState().terminals.get(id);
    return !t || t.exitCode !== null;
  };
  if (exited()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, timeoutMs);
    const off = useTerminals.subscribe(() => {
      if (!exited()) return;
      clearTimeout(timer);
      off();
      resolve(true);
    });
  });
}

/** Keeps the terminal list current and remembers the panel's open state, size and dock. */
export function useTerminalsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const panelOpen = useTerminals((s) => s.panelOpen);
  const panelHeight = useTerminals((s) => s.panelHeight);
  const panelWidth = useTerminals((s) => s.panelWidth);
  const dock = useTerminals((s) => s.dock);

  useEffect(() => {
    if (!client) return;
    const off = client.on('terminals.changed', ({ terminals }) => useTerminals.getState().setTerminals(terminals));
    void client.call('terminal.list', {}).then(({ terminals }) => useTerminals.getState().setTerminals(terminals));
    void client.call('appState.get', { key: PANEL_KEY }).then(({ value }) => {
      const stored = value as { open?: unknown; height?: unknown; width?: unknown; dock?: unknown } | null;
      if (typeof stored?.height === 'number') useTerminals.getState().setPanelHeight(stored.height);
      if (typeof stored?.width === 'number') useTerminals.getState().setPanelWidth(stored.width);
      useTerminals.getState().setDock(parseDock(stored?.dock));
      if (typeof stored?.open === 'boolean') useTerminals.getState().togglePanel(stored.open);
    });
    return off;
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const timer = setTimeout(() => void client.call('appState.set', { key: PANEL_KEY, value: { open: panelOpen, height: panelHeight, width: panelWidth, dock } }), 300);
    return () => clearTimeout(timer);
  }, [client, panelOpen, panelHeight, panelWidth, dock]);
}
