import type { Effort, PermissionMode } from '@switchboard/protocol/client';

export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const EFFORT_LABEL: Record<Effort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

/** One line per mode for the permission menu. */
export const MODE_DESCRIPTION: Partial<Record<PermissionMode, string>> = {
  default: 'Asks before each edit or command',
  acceptEdits: 'Edits files without asking, asks for commands',
  plan: 'Explores and proposes a plan, changes nothing',
  auto: 'Runs safe actions itself, asks for risky ones',
};

/** The status dot per mode, as a theme colour. */
export const MODE_DOT: Partial<Record<PermissionMode, string>> = {
  default: 'bg-faint',
  acceptEdits: 'bg-ok',
  plan: 'bg-link',
  auto: 'bg-accent-ink',
};

/** The effort dial: clicking the selected step again goes back to the default effort. */
export function toggleEffort(current: Effort | '', clicked: Effort): Effort | '' {
  return current === clicked ? '' : clicked;
}

/** The plain-language line under the route tray: where the edits of this session land. */
export function routeHint(route: { worktree: boolean; isGitRepo: boolean; branch: string | null; name: string }): string {
  if (route.worktree) return `Isolated in .claude/worktrees/${route.name || '<name>'} · your checkout stays untouched`;
  if (!route.isGitRepo) return 'Edits land directly in this folder (not a git repository)';
  return `Edits land directly in your working copy${route.branch ? ` on ${route.branch}` : ''}`;
}
