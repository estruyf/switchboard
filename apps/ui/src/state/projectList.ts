import type { ProjectInfo } from '@switchboard/protocol/client';
import { basename, tildify } from '../lib/format.ts';
import { fuzzyScore } from '../lib/fuzzy.ts';

/** The user's projects (added by hand), in their order. */
export function addedProjects(projects: Map<string, ProjectInfo>): ProjectInfo[] {
  return [...projects.values()].filter((p) => p.added).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name));
}

/**
 * Folders Claude Code has sessions for, most recent first (the Add project picker), filtered by
 * name or path when `query` is set. Projects already added stay in the list and are marked there.
 */
export function knownFolders(projects: Map<string, ProjectInfo>, query: string, home: string | null): ProjectInfo[] {
  const folders = [...projects.values()].filter((p) => p.sessionCount > 0).sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
  if (!query.trim()) return folders;
  return folders
    .map((p) => ({ p, score: Math.max(fuzzyScore(query, p.name) ?? -Infinity, (fuzzyScore(query, tildify(p.root, home)) ?? -Infinity) - 2) }))
    .filter((r) => r.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.p);
}

/** Moves `root` one place up or down in the list of roots; returns the list unchanged at either end. */
export function moveRoot(roots: string[], root: string, delta: -1 | 1): string[] {
  const index = roots.indexOf(root);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= roots.length) return roots;
  const next = [...roots];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** A project's display name for a folder that may not be a project. */
export const folderName = (projects: Map<string, ProjectInfo>, root: string) => projects.get(root)?.name ?? basename(root);
