import { describe, expect, it } from 'vitest';
import { routeHint, toggleEffort } from './route.ts';

describe('new session route', () => {
  it('clears the effort when the selected step is clicked again', () => {
    expect(toggleEffort('', 'high')).toBe('high');
    expect(toggleEffort('high', 'max')).toBe('max');
    expect(toggleEffort('max', 'max')).toBe('');
  });

  it('says where the edits land', () => {
    expect(routeHint({ worktree: false, isGitRepo: true, branch: 'main', name: '' })).toBe('Edits land directly in your working copy on main');
    expect(routeHint({ worktree: false, isGitRepo: true, branch: null, name: '' })).toBe('Edits land directly in your working copy');
    expect(routeHint({ worktree: false, isGitRepo: false, branch: null, name: '' })).toMatch(/not a git repository/);
    expect(routeHint({ worktree: true, isGitRepo: true, branch: 'main', name: 'fix-login' })).toBe('Isolated in .claude/worktrees/fix-login · your checkout stays untouched');
  });
});
