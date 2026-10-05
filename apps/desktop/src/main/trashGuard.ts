import { basename, join, resolve, sep } from 'node:path';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.jsonl)?$/i;

/**
 * Only Claude Code session files may go to the Trash: a transcript
 * (`<uuid>.jsonl`) or its subagent folder (`<uuid>`) inside the projects folder.
 * A second guard behind the engine's own checks.
 */
export function isTrashableSessionPath(path: string, claudeConfigDir: string): boolean {
  const projects = join(claudeConfigDir, 'projects') + sep;
  return resolve(path) === path && path.startsWith(projects) && SESSION_ID.test(basename(path));
}
