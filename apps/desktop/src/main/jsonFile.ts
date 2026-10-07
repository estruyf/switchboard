import { copyFileSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/**
 * Reads a JSON file, or undefined when there is none. A file that can't be parsed is copied to `<file>.bak`
 * first, so falling back to defaults (and saving over it later) never loses what was in it.
 */
export function readJsonFile(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    try {
      copyFileSync(file, `${file}.bak`);
    } catch {
      // Nothing more to keep it with.
    }
    return undefined;
  }
}

/**
 * Writes the file in one step: to a temporary file next to it, then renamed over it. A crash
 * half way leaves the old file, never a truncated one. Throws like writeFileSync.
 */
export function writeFileAtomic(file: string, text: string): void {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, text);
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
