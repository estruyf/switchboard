import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
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

/** Records that are the conversation itself; their timestamps are real activity. */
const ACTIVITY_TYPES = new Set(['user', 'assistant', 'system']);
const TAIL_STEPS = [64 * 1024, 1024 * 1024];

/**
 * When the conversation last moved: the timestamp of the last message in the
 * transcript. The file's mtime is not that: Claude Code appends bookkeeping
 * (`last-prompt`, `cost-state`, titles) when a process exits or a session is
 * reopened, which would make old sessions look new. Reads only the tail, a
 * little more if the last records are huge. Null when nothing usable is found.
 */
export function readLastActivity(path: string): number | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    for (const step of TAIL_STEPS) {
      const length = Math.min(step, size);
      const buffer = Buffer.alloc(length);
      const bytes = readSync(fd, buffer, 0, length, size - length);
      const lines = buffer.toString('utf8', 0, bytes).split('\n');
      // The first line is cut off unless the whole file was read.
      const from = length === size ? 0 : 1;
      for (let i = lines.length - 1; i >= from; i--) {
        const line = lines[i]!;
        if (!line.includes('"timestamp"')) continue;
        try {
          const record = JSON.parse(line) as { type?: unknown; timestamp?: unknown };
          if (typeof record.type !== 'string' || !ACTIVITY_TYPES.has(record.type) || typeof record.timestamp !== 'string') continue;
          const at = Date.parse(record.timestamp);
          if (Number.isFinite(at)) return at;
        } catch {
          // A partial or foreign line; keep looking.
        }
      }
      if (length === size) break;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
