import { closeSync, openSync, readSync } from 'node:fs';
import type { SessionOrigin } from '@switchboard/protocol';

/** Maps Claude Code's `entrypoint` value to a coarse origin for badges. */
export function originFromEntrypoint(entrypoint: string | null | undefined): SessionOrigin {
  if (!entrypoint) return 'unknown';
  if (entrypoint === 'switchboard') return 'app';
  if (entrypoint === 'cli') return 'cli';
  if (entrypoint.startsWith('claude-desktop')) return 'desktop';
  if (entrypoint.startsWith('sdk')) return 'sdk';
  if (/vscode|jetbrains|cursor|windsurf|zed|ide/.test(entrypoint)) return 'ide';
  return 'unknown';
}

const HEAD_BYTES = 64 * 1024;

/**
 * Reads the `entrypoint` recorded in a transcript's first records. Only the
 * head of the file is read, so this stays cheap for very large transcripts.
 */
export function readEntrypoint(path: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(HEAD_BYTES);
    const bytes = readSync(fd, buffer, 0, HEAD_BYTES, 0);
    return /"entrypoint":"([^"]+)"/.exec(buffer.toString('utf8', 0, bytes))?.[1] ?? null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
