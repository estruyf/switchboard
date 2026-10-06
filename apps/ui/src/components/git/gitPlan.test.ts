import { describe, expect, it } from 'vitest';
import type { WorktreeStatus } from '@switchboard/protocol/client';
import { gitSummary, planGit, stepCount } from './gitPlan.ts';

const base: WorktreeStatus = {
  path: '/repo',
  root: '/repo',
  isWorktree: false,
  branch: 'feature',
  baseBranch: 'main',
  ahead: 0,
  behind: 0,
  uncommitted: 0,
  upstream: 'origin/feature',
  unpushed: 0,
  behindUpstream: 0,
  hasRemote: true,
  pushRemote: 'origin',
  mainCheckout: { branch: null, dirty: false },
};
const status = (over: Partial<WorktreeStatus>): WorktreeStatus => ({ ...base, ...over });
const plan = (over: Partial<WorktreeStatus>, busy = false) => planGit(status(over), busy);

describe('planGit: the primary action', () => {
  it('pulls when behind the upstream, before anything else', () => {
    const p = plan({ behindUpstream: 2, uncommitted: 3, ahead: 1, unpushed: 1 });
    expect(p.primary).toBe('pull');
    expect(stepCount(status({ behindUpstream: 2 }), 'pull')).toBe(2);
  });

  it('commits uncommitted changes', () => {
    expect(plan({ uncommitted: 3, ahead: 1, unpushed: 1 }).primary).toBe('commit');
    expect(stepCount(status({ uncommitted: 3 }), 'commit')).toBe(3);
  });

  it('pushes commits ahead of the upstream, or a new branch with commits', () => {
    expect(plan({ ahead: 1, unpushed: 1 }).primary).toBe('push');
    expect(stepCount(status({ ahead: 4, unpushed: 1 }), 'push')).toBe(1);
    expect(plan({ upstream: null, unpushed: null, behindUpstream: null, ahead: 2 }).primary).toBe('push');
    expect(stepCount(status({ upstream: null, unpushed: null, ahead: 2 }), 'push')).toBe(2);
    expect(plan({ branch: 'main', upstream: 'origin/main', unpushed: 1 }).primary).toBe('push');
  });

  it('offers a PR when clean and pushed, on a branch or a worktree with commits', () => {
    expect(plan({ ahead: 1 }).primary).toBe('pr');
    expect(plan({ ahead: 1, isWorktree: true, branch: 'worktree-fix', upstream: 'origin/worktree-fix' }).primary).toBe('pr');
  });

  it('fetches when clean on the base branch, or with nothing to offer', () => {
    expect(plan({ branch: 'main', upstream: 'origin/main' }).primary).toBe('fetch');
    expect(plan({}).primary).toBe('fetch');
    expect(plan({ hasRemote: false, pushRemote: null, upstream: null, unpushed: null, behindUpstream: null, ahead: 1 }).primary).toBe('fetch');
  });
});

describe('planGit: what can run', () => {
  it('says why each step is unavailable on a checkout in sync', () => {
    expect(plan({}).blocked).toEqual({ fetch: null, commit: 'Nothing to commit', pull: 'Up to date with origin/feature', push: 'Nothing to push', pr: 'No commits ahead of main' });
  });

  it('offers no PR from the base branch', () => {
    expect(plan({ branch: 'main', upstream: 'origin/main', unpushed: 1 }).blocked.pr).toBe('On main, the base branch');
  });

  it('blocks push and PR while behind the upstream, and says so', () => {
    const p = plan({ behindUpstream: 1, ahead: 1, unpushed: 1 });
    expect(p.blocked.push).toBe('Behind upstream. Pull first');
    expect(p.blocked.pr).toBe('Behind upstream. Pull first');
    expect(p.blocked.pull).toBeNull();
    expect(p.note).toBe('Behind upstream by 1 commit. Pull before you push.');
    expect(plan({ behindUpstream: 2 }).note).toBe('Behind upstream by 2 commits. Pull before you push.');
  });

  it('waits for Claude before committing or pulling', () => {
    const p = plan({ uncommitted: 1, behindUpstream: 1 }, true);
    expect(p.blocked.commit).toBe('Claude is working');
    expect(p.blocked.pull).toBe('Claude is working in this folder');
    expect(p.blocked.fetch).toBeNull();
  });

  it('needs a remote for everything but commit', () => {
    const p = plan({ hasRemote: false, pushRemote: null, upstream: null, unpushed: null, behindUpstream: null, uncommitted: 1, ahead: 1 });
    expect(p.blocked).toMatchObject({ fetch: 'No remote', commit: null, pull: 'No remote', push: 'No remote', pr: 'No remote' });
  });
});

describe('gitSummary', () => {
  it('counts behind, ahead and changed files', () => {
    expect(gitSummary(status({ behindUpstream: 2, unpushed: 0, uncommitted: 3 }))).toBe('↓2 behind · ↑0 ahead · 3 changed files');
    expect(gitSummary(status({ uncommitted: 1 }))).toBe('↓0 behind · ↑0 ahead · 1 changed file');
  });

  it('says when the branch has no upstream or the repository no remote', () => {
    expect(gitSummary(status({ upstream: null, unpushed: null, behindUpstream: null, ahead: 2 }))).toBe('Not pushed yet · ↑2 ahead of main · 0 changed files');
    expect(gitSummary(status({ hasRemote: false, upstream: null }))).toBe('No remote · 0 changed files');
  });
});
