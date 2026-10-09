import { APP_DATA_FOLDERS, COMPANION_DIR, COMPANION_INFO_FILE, COMPANION_PROTOCOL, type CompanionInfo } from '@switchboard/protocol/companion-client';

/**
 * Finding a running Switchboard: its engine writes `engine.json` (the socket and a token) in the app's data folder.
 * Pure apart from the reads it is given, so it can be tested.
 */

/** The `engine.json` files to look at, in order: the folder from the settings, or the installed app, then a dev build. */
export function infoFiles(home: string, appDataFolder: string): string[] {
  const folders = appDataFolder.trim() ? [appDataFolder.trim().replace(/^~(?=\/)/, home)] : APP_DATA_FOLDERS.map((name) => `${home}/Library/Application Support/${name}`);
  return folders.map((folder) => `${folder.replace(/\/+$/, '')}/${COMPANION_DIR}/${COMPANION_INFO_FILE}`);
}

/** `engine.json` as written by a running engine; null when it doesn't read as one. */
export function parseInfo(text: string): CompanionInfo | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const info = value as Record<string, unknown>;
  if (typeof info.socket !== 'string' || !info.socket.startsWith('/') || typeof info.token !== 'string' || !info.token) return null;
  if (typeof info.pid !== 'number' || typeof info.protocol !== 'number') return null;
  return {
    protocol: info.protocol,
    socket: info.socket,
    token: info.token,
    pid: info.pid,
    startedAt: typeof info.startedAt === 'number' ? info.startedAt : 0,
    appVersion: typeof info.appVersion === 'string' ? info.appVersion : '',
  };
}

export type Found = { kind: 'found'; info: CompanionInfo; file: string } | { kind: 'none' } | { kind: 'incompatible'; info: CompanionInfo };

/**
 * The first file of a running engine that speaks this extension's protocol. A file left behind by a crash (its
 * process is gone) is skipped; one from a newer or older Switchboard says so.
 */
export function pickInfo(files: ReadonlyArray<{ file: string; text: string | null }>, alive: (pid: number) => boolean): Found {
  let incompatible: CompanionInfo | null = null;
  for (const { file, text } of files) {
    const info = text === null ? null : parseInfo(text);
    if (!info || !alive(info.pid)) continue;
    if (info.protocol !== COMPANION_PROTOCOL) {
      incompatible ??= info;
      continue;
    }
    return { kind: 'found', info, file };
  }
  return incompatible ? { kind: 'incompatible', info: incompatible } : { kind: 'none' };
}
