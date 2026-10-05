import type { PermissionMode } from '@switchboard/protocol/client';

export const MODE_LABEL: Record<PermissionMode, string> = {
  default: 'Ask before edits',
  acceptEdits: 'Accept edits',
  plan: 'Plan mode',
  auto: 'Auto mode',
  dontAsk: "Don't ask",
  bypassPermissions: 'Bypass permissions',
};

/** Modes offered in menus. Bypass is left out on purpose. */
export const MODE_CHOICES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto'];

/** ⇧Tab cycles like the Claude Code CLI. */
export function nextMode(mode: PermissionMode): PermissionMode {
  const cycle: PermissionMode[] = ['default', 'acceptEdits', 'plan'];
  const index = cycle.indexOf(mode);
  return cycle[(index + 1) % cycle.length]!;
}

/** Worktree name from the first words of a prompt: `fix-the-login-redirect`. */
export function worktreeSlug(prompt: string, now = Date.now()): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || `session-${new Date(now).toISOString().slice(0, 10)}`;
}
