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
} as const;

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
  /** Native image picker (for project icons). Resolves to null when cancelled. */
  pickImage(defaultPath?: string): Promise<string | null>;
}
