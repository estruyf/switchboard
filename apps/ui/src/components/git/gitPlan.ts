import type { WorktreeStatus } from '@switchboard/protocol/client';

/** What the session header's git button can do. Commit asks Claude; the others run git in a terminal tab. */
export type GitStep = 'commit' | 'pull' | 'push' | 'pr';

export interface GitPlan {
  /** The step the button offers on its face: the next thing the checkout needs (possibly blocked, see `blocked`), or null when it is in sync. */
  primary: GitStep | null;
  /** Why each step can't run now, or null when it can. */
  blocked: Record<GitStep, string | null>;
  /** A warning for the menu, such as being behind the upstream. */
  note: string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Works out which git steps make sense for a checkout. `busy`: Claude is working in this session. */
export function planGit(status: WorktreeStatus, busy: boolean): GitPlan {
  const behind = status.behindUpstream ?? 0;
  const noRemote = !status.hasRemote ? 'No remote' : null;
  const detached = !status.branch ? 'HEAD is detached' : null;
  const pullFirst = behind > 0 ? 'Behind upstream. Pull first' : null;
  const onBase = status.branch !== null && status.branch === status.baseBranch;

  const blocked: Record<GitStep, string | null> = {
    commit: status.uncommitted === 0 ? 'Nothing to commit' : busy ? 'Claude is working' : null,
    pull: noRemote ?? detached ?? (!status.upstream ? 'No upstream branch yet' : behind === 0 ? `Up to date with ${status.upstream}` : busy ? 'Claude is working in this folder' : null),
    push: noRemote ?? detached ?? pullFirst ?? (status.upstream && status.unpushed === 0 ? 'Nothing to push' : null),
    pr:
      noRemote ??
      detached ??
      (onBase ? `On ${status.branch}, the base branch` : null) ??
      pullFirst ??
      (status.ahead === 0 ? `No commits ahead of ${status.baseBranch ?? 'the base branch'}` : null),
  };

  // The order a branch usually goes through: catch up, commit, push, then open a pull request.
  const wants: Record<GitStep, boolean> = {
    pull: behind > 0,
    commit: status.uncommitted > 0,
    push: status.hasRemote && (status.upstream ? (status.unpushed ?? 0) > 0 : !onBase && status.ahead > 0),
    pr: status.hasRemote && !onBase && status.ahead > 0,
  };
  const order: GitStep[] = ['pull', 'commit', 'push', 'pr'];
  const primary = order.find((step) => wants[step]) ?? null;

  const note = behind > 0 ? `Behind ${status.upstream} by ${plural(behind, 'commit', 'commits')}. Pull first.` : null;
  return { primary, blocked, note };
}

export const STEP_LABEL: Record<GitStep, string> = { commit: 'Commit', pull: 'Pull', push: 'Push', pr: 'Create PR' };
