import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ChangedFile, ChangesBase, GitChanges, WorktreeStatus } from '@switchboard/protocol';

const MAX_DIFF_BYTES = 512 * 1024;

export class GitError extends Error {}

/** Runs git in `cwd`; resolves with stdout. Never goes through a shell. */
export function git(cwd: string, args: string[], options: { env?: Record<string, string>; allowExitCodes?: number[] } = {}): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      args,
      { cwd, env: { ...process.env, ...options.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }, maxBuffer: 32 * 1024 * 1024, timeout: 20_000 },
      (error, stdout, stderr) => {
        const code = typeof error?.code === 'number' ? error.code : error ? 1 : 0;
        if (error && !options.allowExitCodes?.includes(code)) reject(new GitError(stderr.trim() || error.message));
        else resolvePromise(stdout);
      },
    );
  });
}

/** The branch a worktree or feature branch would merge into: origin's default branch, else main/master. */
export async function baseBranch(cwd: string): Promise<string | null> {
  const remoteHead = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { allowExitCodes: [1, 128] }).catch(() => '');
  if (remoteHead.trim()) return remoteHead.trim().replace(/^origin\//, '');
  for (const name of ['main', 'master', 'trunk', 'develop']) {
    const exists = await git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { allowExitCodes: [1] }).catch(() => '');
    if (exists.trim()) return name;
  }
  return null;
}

/** The commit `base` mode compares against: where this branch left the base branch. */
async function mergeBase(cwd: string, base: string): Promise<string | null> {
  for (const ref of [`origin/${base}`, base]) {
    const sha = await git(cwd, ['merge-base', 'HEAD', ref], { allowExitCodes: [1, 128] }).catch(() => '');
    if (sha.trim()) return sha.trim();
  }
  return null;
}

const STATUS: Record<string, ChangedFile['status']> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified', U: 'conflicted' };

/** `--numstat -z` output: additions, deletions and path (renames carry two paths). */
function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
  const stats = new Map<string, { additions: number; deletions: number }>();
  const parts = output.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]!;
    if (!line) continue;
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(line);
    if (!match) continue;
    let path = match[3]!;
    // A rename: the path field is empty and the old and new paths follow.
    if (path === '') {
      i += 2;
      path = parts[i] ?? '';
    }
    stats.set(path, { additions: match[1] === '-' ? 0 : Number(match[1]), deletions: match[2] === '-' ? 0 : Number(match[2]) });
  }
  return stats;
}

/**
 * What changed in a checkout. `uncommitted`: the working tree and index against HEAD,
 * plus untracked files. `branch`: everything since the branch left its base (commits and
 * uncommitted work together), which is what a merge or PR would contain.
 */
export async function listChanges(cwd: string, base: ChangesBase): Promise<GitChanges> {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const branch = (await git(root, ['branch', '--show-current'])).trim() || null;
  const baseName = await baseBranch(root);
  const files = new Map<string, ChangedFile>();

  if (base === 'branch') {
    const from = baseName ? await mergeBase(root, baseName) : null;
    if (!from) return { root, branch, baseBranch: baseName, base, files: [], error: baseName ? `No common history with ${baseName}` : 'No base branch found' };
    const names = await git(root, ['diff', '--name-status', '-z', '-M', from]);
    const parts = names.split('\0').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const code = parts[i]!;
      const path = code.startsWith('R') || code.startsWith('C') ? parts[(i += 2)]! : parts[++i]!;
      files.set(path, { path, status: STATUS[code[0]!] ?? 'modified', additions: 0, deletions: 0, staged: false });
    }
    for (const [path, stat] of parseNumstat(await git(root, ['diff', '--numstat', '-z', '-M', from]))) {
      const file = files.get(path);
      if (file) Object.assign(file, stat);
    }
  } else {
    // porcelain v1 with -z: "XY path", renames followed by the old path.
    const status = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const parts = status.split('\0').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i]!;
      const x = entry[0]!;
      const y = entry[1]!;
      const path = entry.slice(3);
      if (x === 'R' || x === 'C') i++;
      const kind = x === '?' ? 'untracked' : x === 'U' || y === 'U' ? 'conflicted' : (STATUS[x !== ' ' ? x : y] ?? 'modified');
      files.set(path, { path, status: kind, additions: 0, deletions: 0, staged: x !== ' ' && x !== '?' && y === ' ' });
    }
    const hasHead = (await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowExitCodes: [1] })).trim() !== '';
    if (hasHead) {
      for (const [path, stat] of parseNumstat(await git(root, ['diff', 'HEAD', '--numstat', '-z', '-M']))) {
        const file = files.get(path);
        if (file) Object.assign(file, stat);
      }
    }
    // Untracked files count as all-new lines (only for text files of a sensible size).
    for (const file of files.values()) {
      if (file.status !== 'untracked') continue;
      try {
        const stat = statSync(join(root, file.path));
        if (stat.size >= MAX_DIFF_BYTES) continue;
        const added = (await git(root, ['diff', '--no-index', '--numstat', '--', '/dev/null', file.path], { allowExitCodes: [1] })).split('\t')[0];
        file.additions = added && added !== '-' ? Number(added) : 0;
      } catch {
        // Unreadable; leave the count at 0.
      }
    }
  }
  return { root, branch, baseBranch: baseName, base, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), error: null };
}

/** Keeps a path inside the repository (no absolute paths, no `..` escapes). */
export function insideRepo(root: string, path: string): string {
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new GitError(`Not a path inside the repository: ${path}`);
  return rel;
}

/** One file's unified diff, for the mode the list was made in. Large diffs are cut off. */
export async function fileDiff(cwd: string, base: ChangesBase, path: string): Promise<{ diff: string; truncated: boolean }> {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const rel = insideRepo(root, path);
  let diff: string;
  if (base === 'branch') {
    const name = await baseBranch(root);
    const from = name ? await mergeBase(root, name) : null;
    if (!from) return { diff: '', truncated: false };
    diff = await git(root, ['diff', '-M', from, '--', rel]);
  } else {
    const tracked = (await git(root, ['ls-files', '--error-unmatch', '--', rel], { allowExitCodes: [1] })).trim() !== '';
    const hasHead = (await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowExitCodes: [1] })).trim() !== '';
    diff = tracked && hasHead ? await git(root, ['diff', 'HEAD', '-M', '--', rel]) : await git(root, ['diff', '--no-index', '--', '/dev/null', rel], { allowExitCodes: [1] });
  }
  const truncated = diff.length > MAX_DIFF_BYTES;
  return { diff: truncated ? diff.slice(0, MAX_DIFF_BYTES) : diff, truncated };
}

export async function stage(cwd: string, paths: string[], staged: boolean): Promise<void> {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const rels = paths.map((p) => insideRepo(root, p));
  if (rels.length === 0) return;
  if (staged) await git(root, ['add', '--', ...rels]);
  else await git(root, ['restore', '--staged', '--', ...rels]);
}

/**
 * Puts tracked files back to HEAD (index and working tree). Untracked files are
 * returned for the caller to move to the Trash, so nothing is deleted outright.
 */
export async function revert(cwd: string, paths: string[]): Promise<{ root: string; untracked: string[] }> {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const rels = paths.map((p) => insideRepo(root, p));
  const tracked: string[] = [];
  const untracked: string[] = [];
  for (const rel of rels) {
    const known = (await git(root, ['ls-files', '--error-unmatch', '--', rel], { allowExitCodes: [1] })).trim() !== '';
    // `cat-file -e` exits 0 only when HEAD has the file.
    const inHead = known && (await git(root, ['cat-file', '-e', `HEAD:${rel}`]).then(() => true, () => false));
    if (inHead) tracked.push(rel);
    else {
      // Added but never committed: unstage it, then it's an untracked file.
      if (known) await git(root, ['rm', '--cached', '--quiet', '--', rel]);
      untracked.push(join(root, rel));
    }
  }
  if (tracked.length) await git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked]);
  return { root, untracked };
}

/** Where a worktree stands before finishing it: what a merge, PR or removal would involve. */
export async function worktreeStatus(cwd: string): Promise<WorktreeStatus> {
  const path = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const commonDir = resolve(path, (await git(path, ['rev-parse', '--git-common-dir'])).trim());
  const root = commonDir.endsWith(`${sep}.git`) ? commonDir.slice(0, -5) : commonDir;
  const isWorktree = root !== path;
  const branch = (await git(path, ['branch', '--show-current'])).trim() || null;
  const base = await baseBranch(path);
  const count = async (range: string) => Number((await git(path, ['rev-list', '--count', range], { allowExitCodes: [128] }).catch(() => '0')).trim() || 0);
  // Renames carry their old path as an extra entry; count only the entries that start with a status.
  const uncommitted = (await git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).split('\0').filter((e) => /^[ MADRCU?!]{2} /.test(e)).length;
  const upstream = (await git(path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { allowExitCodes: [128] }).catch(() => '')).trim() || null;
  const remotes = (await git(path, ['remote'])).split('\n').filter(Boolean);
  const mainBranch = isWorktree ? (await git(root, ['branch', '--show-current']).catch(() => '')).trim() || null : null;
  const mainDirty = isWorktree ? (await git(root, ['status', '--porcelain=v1', '--untracked-files=no']).catch(() => '')).trim() !== '' : false;
  return {
    path,
    root,
    isWorktree,
    branch,
    baseBranch: base,
    ahead: base && branch ? await count(`${base}..${branch}`) : 0,
    behind: base && branch ? await count(`${branch}..${base}`) : 0,
    uncommitted,
    upstream,
    unpushed: upstream ? await count(`${upstream}..HEAD`) : null,
    hasRemote: remotes.length > 0,
    mainCheckout: { branch: mainBranch, dirty: mainDirty },
  };
}

/** Removes a worktree (refuses with uncommitted changes) and optionally its branch. */
export async function removeWorktree(status: WorktreeStatus, deleteBranch: boolean): Promise<void> {
  if (!status.isWorktree) throw new GitError('This folder is not a worktree');
  await git(status.root, ['worktree', 'remove', status.path]);
  if (deleteBranch && status.branch) await git(status.root, ['branch', '-D', status.branch]);
}
