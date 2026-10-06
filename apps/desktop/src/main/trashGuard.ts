import { lstatSync, statSync } from 'node:fs';
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

/** A Claude Code config folder named by the engine: an absolute, normalised path with a projects folder. */
export function isConfigDir(dir: unknown): dir is string {
  if (typeof dir !== 'string' || resolve(dir) !== dir || dir === sep) return false;
  return statSync(join(dir, 'projects'), { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/**
 * A file a "revert" may move to the Trash: a regular file inside a git checkout
 * (one with a `.git` entry at its root), never the root itself or anything in `.git`.
 */
export function isTrashableRepoFile(path: string, repoRoot: string): boolean {
  if (resolve(path) !== path || resolve(repoRoot) !== repoRoot) return false;
  if (!path.startsWith(repoRoot + sep)) return false;
  const inside = path.slice(repoRoot.length + 1);
  if (inside === '.git' || inside.startsWith(`.git${sep}`)) return false;
  if (!statSync(join(repoRoot, '.git'), { throwIfNoEntry: false })) return false;
  const stat = lstatSync(path, { throwIfNoEntry: false });
  return !!stat && (stat.isFile() || stat.isSymbolicLink());
}
