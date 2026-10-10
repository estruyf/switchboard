import { z } from 'zod';
import { WorktreePullRequest } from './worktrees.ts';

/** A branch in the repository (`refs/heads/<name>`). */
export const LocalBranch = z.object({
  sha: z.string(),
  /** Its upstream (`origin/feature`), or null without one (or when it is gone). */
  upstream: z.string().nullable(),
  /** It had an upstream that was deleted on the remote (`[gone]`). */
  upstreamGone: z.boolean(),
  /** Commits it has that its upstream doesn't, and the other way round. Null without an upstream. */
  aheadOfUpstream: z.number().nullable(),
  behindUpstream: z.number().nullable(),
  /** Commits beyond the base that no remote has: what deleting it would lose. */
  unpushed: z.number(),
  /** Checked out in the main checkout or a worktree (that folder); git won't delete it there. */
  checkedOutIn: z.string().nullable(),
  /** It never got a commit of its own: its oldest reflog entry (where it was made) is still its tip. */
  neverCommitted: z.boolean(),
});
export type LocalBranch = z.infer<typeof LocalBranch>;

/** A branch on a remote (`refs/remotes/<remote>/<name>`), as of the last fetch. */
export const RemoteBranch = z.object({
  /** The remote's name (`origin`). */
  remote: z.string(),
  /** `origin/feature`. */
  ref: z.string(),
  sha: z.string(),
  /** The remote's default branch (`origin/HEAD` points at it): never deleted. */
  isDefault: z.boolean(),
});
export type RemoteBranch = z.infer<typeof RemoteBranch>;

/** One branch name, with its copy here and its copy on a remote (either may be missing). */
export const BranchEntry = z.object({
  name: z.string(),
  local: LocalBranch.nullable(),
  /** The local branch's upstream, or `<remote>/<name>` on the remote it pushes to; for a remote-only row, that branch. */
  remote: RemoteBranch.nullable(),
  /** The branch everything merges into (`main`): never deleted, here or on the remote. */
  isBase: z.boolean(),
  /** Commits on the branch that the base doesn't have, and the other way round. Null for the base or without one. */
  ahead: z.number().nullable(),
  behind: z.number().nullable(),
  /** Every commit of it is in the base (by ancestry with `origin/<base>`), and it isn't the base itself. */
  merged: z.boolean(),
  /** The newest pull request for the branch; null without one, or without `gh`. */
  pr: WorktreePullRequest.nullable(),
  /** The newest commit (of the local copy, else the remote's), in ms. */
  lastCommitAt: z.number().nullable(),
  /** Its subject line, for the table. */
  subject: z.string().nullable(),
  author: z.string().nullable(),
});
export type BranchEntry = z.infer<typeof BranchEntry>;

export const BranchList = z.object({
  /** The main checkout. */
  root: z.string(),
  baseBranch: z.string().nullable(),
  /** The remotes the repository has (`origin`, `upstream`). */
  remotes: z.array(z.string()),
  /** `gh` answered, so pull requests are known. */
  pullRequests: z.boolean(),
  branches: z.array(BranchEntry),
});
export type BranchList = z.infer<typeof BranchList>;

const BranchName = z
  .string()
  .min(1)
  .max(1024)
  .refine((name) => !name.startsWith('-'), 'Not a branch name');

export const BranchDeleteItem = z.object({
  name: BranchName,
  /** Delete the local branch (`git branch -D`). */
  local: z.boolean().default(false),
  /** Delete it on the remote (`git push <remote> --delete`): `origin/feature`. Null keeps it there. */
  remoteRef: z.string().min(1).max(1024).nullable().default(null),
  /** Save the local branch's tip under `refs/switchboard/removed/<branch>-<date>` first. */
  recoveryRef: z.boolean().default(false),
});
export type BranchDeleteItem = z.infer<typeof BranchDeleteItem>;

export const BranchDeleteResult = z.object({
  name: z.string(),
  ok: z.boolean(),
  /** Why it was refused or failed: BASE, CHECKED_OUT, DEFAULT_BRANCH, OPEN_PR, NOT_FOUND, GIT_FAILED. */
  code: z.string().nullable(),
  error: z.string().nullable(),
  localDeleted: z.boolean(),
  remoteDeleted: z.boolean(),
  recoveryRef: z.string().nullable(),
});
export type BranchDeleteResult = z.infer<typeof BranchDeleteResult>;
