import { describe, expect, it } from 'vitest';
import type { WorktreeStatus } from '@switchboard/protocol/client';
import { planGit } from './gitPlan.ts';

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
const plan = (over: Partial<WorktreeStatus>, busy = false) => planGit({ ...base, ...over }, busy);

describe('planGit', () => {
  it('offers nothing on a checkout in sync', () => {
    const p = plan({});
    expect(p.primary).toBeNull();
    expect(p.blocked).toEqual({ commit: 'Nothing to commit', pull: 'Up to date with origin/feature', push: 'Nothing to push', pr: 'No commits ahead of main' });
  });

  it('goes pull, commit, push, PR', () => {
    expect(plan({ behindUpstream: 2, uncommitted: 3, ahead: 1, unpushed: 1 }).primary).toBe('pull');
    expect(plan({ uncommitted: 3, ahead: 1, unpushed: 1 }).primary).toBe('commit');
    expect(plan({ ahead: 1, unpushed: 1 }).primary).toBe('push');
    expect(plan({ ahead: 1 }).primary).toBe('pr');
  });

  it('pushes a new branch with commits, and offers no PR from the base branch', () => {
    expect(plan({ upstream: null, unpushed: null, behindUpstream: null, ahead: 2 }).primary).toBe('push');
    const main = plan({ branch: 'main', upstream: 'origin/main', unpushed: 1 });
    expect(main.primary).toBe('push');
    expect(main.blocked.pr).toBe('On main, the base branch');
  });

  it('blocks push and PR while behind the upstream, and says so', () => {
    const p = plan({ behindUpstream: 1, ahead: 1, unpushed: 1 });
    expect(p.blocked.push).toBe('Behind upstream. Pull first');
    expect(p.blocked.pr).toBe('Behind upstream. Pull first');
    expect(p.blocked.pull).toBeNull();
    expect(p.note).toBe('Behind origin/feature by 1 commit. Pull first.');
  });

  it('waits for Claude before committing or pulling', () => {
    const p = plan({ uncommitted: 1, behindUpstream: 1 }, true);
    expect(p.blocked.commit).toBe('Claude is working');
    expect(p.blocked.pull).toBe('Claude is working in this folder');
  });

  it('needs a remote for everything but commit', () => {
    const p = plan({ hasRemote: false, pushRemote: null, upstream: null, unpushed: null, behindUpstream: null, uncommitted: 1, ahead: 1 });
    expect(p.blocked).toMatchObject({ commit: null, pull: 'No remote', push: 'No remote', pr: 'No remote' });
    expect(plan({ hasRemote: false, pushRemote: null, upstream: null, unpushed: null, behindUpstream: null, ahead: 1 }).primary).toBeNull();
  });
});
