import { git } from './gitChanges.ts';

/**
 * The GitHub `owner/name` a remote URL points at, lowercased; null for other hosts.
 * Understands the forms git accepts: `git@github.com:o/n.git`, `https://github.com/o/n`,
 * `ssh://git@github.com/o/n.git` and `git://github.com/o/n`.
 */
export function githubRepoFromUrl(url: string): string | null {
  const match = /^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/|(?:[^@/]+@)?github\.com:)([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

/** The GitHub repositories a checkout's remotes point at (none when it isn't a git checkout). */
export async function githubRepos(cwd: string): Promise<string[]> {
  const out = await git(cwd, ['config', '--local', '--get-regexp', '^remote\\..*\\.url$'], { allowExitCodes: [1, 128] }).catch(() => '');
  const repos = out
    .split('\n')
    .map((line) => githubRepoFromUrl(line.slice(line.indexOf(' ') + 1)))
    .filter((repo): repo is string => repo !== null);
  return [...new Set(repos)];
}

/**
 * The first folder, in the order given, with a remote on GitHub's `owner/name`. Folders are checked a
 * few at a time so a long list doesn't start hundreds of git processes, and the search stops at the
 * first batch with a match.
 */
export async function findCheckout(folders: string[], repo: string, reposOf: (cwd: string) => Promise<string[]> = githubRepos, batch = 12): Promise<string | null> {
  const wanted = repo.toLowerCase().replace(/\.git$/, '');
  for (let i = 0; i < folders.length; i += batch) {
    const slice = folders.slice(i, i + batch);
    const found = await Promise.all(slice.map(async (cwd) => (await reposOf(cwd)).includes(wanted)));
    const index = found.indexOf(true);
    if (index >= 0) return slice[index]!;
  }
  return null;
}
