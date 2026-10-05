/**
 * The small API the preload script exposes on `window.switchboard`.
 * Everything else goes over the engine MessagePort, not Electron IPC.
 */

/** `window.postMessage` tag the preload uses to hand the engine port to the page. */
export const ENGINE_PORT_MESSAGE = 'switchboard:engine-port';

/** IPC channel names shared by main and preload. */
export const IpcChannel = {
  requestEnginePort: 'switchboard:request-engine-port',
  enginePort: 'switchboard:engine-port',
  engineRestarted: 'switchboard:engine-restarted',
  rendererReady: 'switchboard:renderer-ready',
  pickFolder: 'switchboard:pick-folder',
  pickImage: 'switchboard:pick-image',
  focusSession: 'switchboard:focus-session',
  selectSession: 'switchboard:select-session',
  quitRequested: 'switchboard:quit-requested',
  quitAnswer: 'switchboard:quit-answer',
  getPreferences: 'switchboard:get-preferences',
  setPreferences: 'switchboard:set-preferences',
  preferencesChanged: 'switchboard:preferences-changed',
  openSettings: 'switchboard:open-settings',
} as const;

/** Appearance: follow macOS, or always light or dark. */
export type ColorScheme = 'system' | 'light' | 'dark';
/** Sidebar rows: a large project icon beside three lines, three lines, or one line. */
export type SidebarStyle = 'large' | 'standard' | 'compact';
/** Tool calls in a conversation: one summary line per run (click for the steps), or every step. */
export type ToolActivity = 'summary' | 'steps';

/** App preferences, kept by main in the app's data folder. */
export interface Preferences {
  colorScheme: ColorScheme;
  sidebarStyle: SidebarStyle;
  toolActivity: ToolActivity;
  /** ⌘Q asks first (a second ⌘Q quits). */
  confirmQuit: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { colorScheme: 'system', sidebarStyle: 'standard', toolActivity: 'summary', confirmQuit: true };

const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => values.includes(value as T);

/** Keeps only valid fields (for files on disk and values from the renderer). */
export function sanitizePreferences(input: unknown): Partial<Preferences> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: Partial<Preferences> = {};
  if (oneOf(['system', 'light', 'dark'] as const, raw.colorScheme)) out.colorScheme = raw.colorScheme;
  if (oneOf(['large', 'standard', 'compact'] as const, raw.sidebarStyle)) out.sidebarStyle = raw.sidebarStyle;
  if (oneOf(['summary', 'steps'] as const, raw.toolActivity)) out.toolActivity = raw.toolActivity;
  if (typeof raw.confirmQuit === 'boolean') out.confirmQuit = raw.confirmQuit;
  return out;
}

/** Sent once per engine connection by the renderer. Used for startup timing and the smoke test. */
export interface RendererReadyReport {
  /** Epoch ms when the first ping came back, i.e. when the UI could talk to the engine. */
  connectedAt: number;
  engineVersion: string;
  claudeVersion: string | null;
  pingMs: number;
  /** Sessions in the first `sessions.list` answer (from cache or scan). */
  sessionCount: number;
}

export interface SwitchboardBridge {
  readonly platform: string;
  /** Asks main for a fresh engine port; it arrives as a window message tagged ENGINE_PORT_MESSAGE. */
  requestEnginePort(): void;
  /** Fires when the engine process was restarted and the old port is dead. */
  onEngineRestarted(listener: () => void): () => void;
  reportReady(report: RendererReadyReport): void;
  /** Native folder picker. Resolves to null when cancelled. */
  pickFolder(defaultPath?: string): Promise<string | null>;
  /** Tells main which session is on screen, so it doesn't notify about what you're already watching. */
  reportFocus(sessionId: string | null): void;
  /** Main asks to show a session (e.g. a notification was clicked). */
  onSelectSession(listener: (sessionId: string) => void): () => void;
  /** Native image picker (for project icons). Resolves to null when cancelled. */
  pickImage(defaultPath?: string): Promise<string | null>;
  /** ⌘Q was pressed: show the quit prompt. Pressing ⌘Q again while it's open quits without it. */
  onQuitRequested(listener: () => void): () => void;
  answerQuit(answer: 'quit' | 'cancel'): void;
  /** Read once when the page loads, so the first paint already uses them. */
  readonly preferences: Preferences;
  /** Applies at once (the colour scheme flips prefers-color-scheme) and is remembered. */
  setPreferences(patch: Partial<Preferences>): void;
  /** Fires in every window after any change, including from the menu bar. */
  onPreferencesChanged(listener: (preferences: Preferences) => void): () => void;
  /** Switchboard → Settings… (⌘,) in the menu bar. */
  onOpenSettings(listener: () => void): () => void;
}
