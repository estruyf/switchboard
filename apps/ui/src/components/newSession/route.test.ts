import { describe, expect, it } from 'vitest';
import { routeHint } from './route.ts';

describe('new session route', () => {
  it('says where the edits land', () => {
    expect(routeHint({ worktree: false, isGitRepo: true, branch: 'main', name: '' })).toBe('Edits land directly in your working copy on main');
    expect(routeHint({ worktree: false, isGitRepo: true, branch: null, name: '' })).toBe('Edits land directly in your working copy');
    expect(routeHint({ worktree: false, isGitRepo: false, branch: null, name: '' })).toMatch(/not a git repository/);
    expect(routeHint({ worktree: true, isGitRepo: true, branch: 'main', name: 'fix-login' })).toBe('Isolated in .claude/worktrees/fix-login · your checkout stays untouched');
  });
});
