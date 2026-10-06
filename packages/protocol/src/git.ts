import { z } from 'zod';

/** `uncommitted`: working tree and index against HEAD. `branch`: everything since the branch left its base. */
export const ChangesBase = z.enum(['uncommitted', 'branch']);
export type ChangesBase = z.infer<typeof ChangesBase>;

export const ChangedFile = z.object({
  /** Relative to the repository root. */
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'untracked', 'conflicted']),
  additions: z.number(),
  deletions: z.number(),
  /** Fully staged (uncommitted mode only). */
  staged: z.boolean(),
});
export type ChangedFile = z.infer<typeof ChangedFile>;

export const GitChanges = z.object({
  root: z.string(),
  branch: z.string().nullable(),
  /** The branch this one would merge into (origin's default, else main/master). */
  baseBranch: z.string().nullable(),
  base: ChangesBase,
  files: z.array(ChangedFile),
  error: z.string().nullable(),
});
export type GitChanges = z.infer<typeof GitChanges>;

export const WorktreeStatus = z.object({
  /** This checkout. */
  path: z.string(),
  /** The main repository. */
  root: z.string(),
  isWorktree: z.boolean(),
  branch: z.string().nullable(),
  baseBranch: z.string().nullable(),
  /** Commits on this branch that the base doesn't have, and the other way round. */
  ahead: z.number(),
  behind: z.number(),
  /** Changed and new files not committed yet. */
  uncommitted: z.number(),
  upstream: z.string().nullable(),
  /** Commits not pushed to the upstream; null without one. */
  unpushed: z.number().nullable(),
  /** Commits on the upstream that this checkout doesn't have yet (as of the last fetch); null without one. */
  behindUpstream: z.number().nullable(),
  hasRemote: z.boolean(),
  /** The remote a branch without an upstream is pushed to: origin when there is one, else the first. */
  pushRemote: z.string().nullable(),
  /** The main checkout, where a merge would happen. */
  mainCheckout: z.object({ branch: z.string().nullable(), dirty: z.boolean() }),
});
export type WorktreeStatus = z.infer<typeof WorktreeStatus>;

/** `pull` and `push` sync the branch with its upstream; `pr` pushes and opens a pull request with gh. */
export const GitSyncAction = z.enum(['pull', 'push', 'pr']);
export type GitSyncAction = z.infer<typeof GitSyncAction>;
