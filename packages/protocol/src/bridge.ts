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
  chooseExportFile: 'switchboard:choose-export-file',
  chooseImportFile: 'switchboard:choose-import-file',
  focusSession: 'switchboard:focus-session',
  selectSession: 'switchboard:select-session',
  quitRequested: 'switchboard:quit-requested',
  quitAnswer: 'switchboard:quit-answer',
  getPreferences: 'switchboard:get-preferences',
  setPreferences: 'switchboard:set-preferences',
  preferencesChanged: 'switchboard:preferences-changed',
  openSettings: 'switchboard:open-settings',
  getAppInfo: 'switchboard:get-app-info',
  getUpdateState: 'switchboard:get-update-state',
  updateState: 'switchboard:update-state',
  updateCommand: 'switchboard:update-command',
  deepLink: 'switchboard:deep-link',
} as const;

/** Appearance: follow macOS, or always light or dark. */
export type ColorScheme = 'system' | 'light' | 'dark';
/** Sidebar rows: a large project icon beside three lines, three lines, or one line. */
export type SidebarStyle = 'large' | 'standard' | 'compact';
/** Tool calls in a conversation: one summary line per run (click for the steps), or every step. */
export type ToolActivity = 'summary' | 'steps';
/** Sessions in the sidebar: only those started or continued in Switchboard, or every Claude Code session. */
export type SessionScope = 'switchboard' | 'all';
/** What a new window shows: Home, the session open last time, or New session. */
export type StartupView = 'home' | 'last' | 'new';
/** Which releases to update to: published releases, or the nightly pre-releases too. */
export type UpdateChannel = 'stable' | 'nightly';

/** App preferences, kept by main in the app's data folder. */
export interface Preferences {
  colorScheme: ColorScheme;
  sidebarStyle: SidebarStyle;
  toolActivity: ToolActivity;
  /** ⌘Q asks first (a second ⌘Q quits). */
  confirmQuit: boolean;
  sessionScope: SessionScope;
  startupView: StartupView;
  /** Check GitHub for a newer release shortly after launch and every few hours. */
  autoUpdate: boolean;
  updateChannel: UpdateChannel;
}

export const DEFAULT_PREFERENCES: Preferences = {
  colorScheme: 'system',
  sidebarStyle: 'standard',
  toolActivity: 'summary',
  confirmQuit: true,
  sessionScope: 'switchboard',
  startupView: 'home',
  autoUpdate: true,
  updateChannel: 'stable',
};

const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => values.includes(value as T);

/** Keeps only valid fields (for files on disk and values from the renderer). */
export function sanitizePreferences(input: unknown): Partial<Preferences> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: Partial<Preferences> = {};
  if (oneOf(['system', 'light', 'dark'] as const, raw.colorScheme)) out.colorScheme = raw.colorScheme;
  if (oneOf(['large', 'standard', 'compact'] as const, raw.sidebarStyle)) out.sidebarStyle = raw.sidebarStyle;
  if (oneOf(['summary', 'steps'] as const, raw.toolActivity)) out.toolActivity = raw.toolActivity;
  if (typeof raw.confirmQuit === 'boolean') out.confirmQuit = raw.confirmQuit;
  if (oneOf(['switchboard', 'all'] as const, raw.sessionScope)) out.sessionScope = raw.sessionScope;
  if (oneOf(['home', 'last', 'new'] as const, raw.startupView)) out.startupView = raw.startupView;
  if (typeof raw.autoUpdate === 'boolean') out.autoUpdate = raw.autoUpdate;
  if (oneOf(['stable', 'nightly'] as const, raw.updateChannel)) out.updateChannel = raw.updateChannel;
  return out;
}

/** The running build, for Settings → About and bug reports. */
export interface AppInfo {
  /** `app.getVersion()`: the release's version (from the tag) in a release build. */
  version: string;
  /** Short commit hash the build was made from; null when git wasn't available at build time. */
  commit: string | null;
  /** A development or unpackaged build: show `dev`, never a release number. */
  dev: boolean;
}

/** `releases/tag/v…` for a version, where its release notes are. */
export const releaseUrl = (version: string) => `https://github.com/estruyf/switchboard/releases/tag/v${version}`;
export const CHANGELOG_URL = 'https://github.com/estruyf/switchboard/blob/main/CHANGELOG.md';

/**
 * Where the updater is. `idle` hasn't checked yet; `disabled` never will (see `disabledReason`).
 * `error` keeps what was known before it failed, so Retry knows what to try again.
 */
export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error' | 'disabled';

/** The updater's whole state: one plain object that main pushes to every window on each change. */
export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  /** A newer version on the chosen channel, once a check found one. */
  availableVersion: string | null;
  /** Downloaded and ready to install on restart. */
  downloadedVersion: string | null;
  /** 0–100 while downloading. */
  downloadPercent: number | null;
  /** The new version's notes as plain text, cleaned up and capped; null when there are none (or they were unusable). */
  releaseNotes: string | null;
  error: string | null;
  /** Retry makes sense (a network error, say), as opposed to a failure that would just happen again. */
  canRetry: boolean;
  /** Why updates are off for this build (development, unpackaged, no feed, turned off by the environment). */
  disabledReason: string | null;
  channel: UpdateChannel;
  /** Epoch ms of the last finished check. */
  checkedAt: number | null;
  /** Set after relaunching into a freshly installed update, so the UI can say so once. */
  updatedTo: string | null;
}

/** What the renderer can ask the updater to do. `retry` repeats whatever failed; `dismiss` clears "Updated to vX". */
export type UpdateCommand = 'check' | 'download' | 'install' | 'retry' | 'dismiss';

/**
 * A validated `switchboard://` link, from main to the renderer. It opens New session with the folder and
 * prompt filled in (and starts the session only with `autostart`), or shows an existing session.
 */
export type DeepLink =
  | {
      action: 'new-session';
      /** Text for the message box (at most 5,000 characters). */
      prompt: string | null;
      /** An absolute local folder. */
      cwd: string | null;
      /** One of your projects, by name; only when there is no `cwd`. */
      project: string | null;
      /** GitHub `owner/name`, resolved to a known checkout; only when there is neither `cwd` nor `project`. */
      repo: string | null;
      /** Start the session at once instead of waiting for Enter. Needs a prompt and a folder the link names. */
      autostart: boolean;
    }
  | { action: 'session'; sessionId: string };

/** A link to act on, or why one was refused (shown briefly; nothing changes). */
export type DeepLinkMessage = { link: DeepLink } | { error: string };

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
  /** Native save dialog for a settings export, suggesting `defaultName`. Resolves to null when cancelled. */
  chooseExportFile(defaultName: string): Promise<string | null>;
  /** Native open dialog for a settings file to import. Resolves to null when cancelled. */
  chooseImportFile(): Promise<string | null>;
  /** The path on disk of a dropped file or folder; empty for files that aren't on disk (made in the page, pasted). */
  getPathForFile(file: File): string;
  /** ⌘Q was pressed: show the quit prompt. Pressing ⌘Q again while it's open quits without it. */
  onQuitRequested(listener: () => void): () => void;
  answerQuit(answer: 'quit' | 'cancel'): void;
  /** Read once when the page loads, so the first paint already uses them. */
  readonly preferences: Preferences;
  /** Applies at once (the colour scheme flips prefers-color-scheme) and is remembered. */
  setPreferences(patch: Partial<Preferences>): void;
  /** Fires in every window after any change, including from the menu bar. */
  onPreferencesChanged(listener: (preferences: Preferences) => void): () => void;
  /** Switchboard → Settings… (⌘,) in the menu bar, or Check for Updates… (which opens About). */
  onOpenSettings(listener: (section: 'about' | null) => void): () => void;
  /** Read once when the page loads. */
  readonly appInfo: AppInfo;
  /** Read once when the page loads; then follow `onUpdateState`. */
  readonly updateState: UpdateState;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
  /** Check, download, install (restarts the app) or retry. The state arrives through `onUpdateState`. */
  update(command: UpdateCommand): void;
  /** Saves the channel in Preferences and checks again right away. */
  setUpdateChannel(channel: UpdateChannel): void;
  /** A `switchboard://` link was opened (main holds links until this window's renderer is ready). */
  onDeepLink(listener: (message: DeepLinkMessage) => void): () => void;
}
