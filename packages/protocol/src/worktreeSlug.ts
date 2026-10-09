/** Worktree name from the first words of a prompt: `fix-the-login-redirect`. Plain TypeScript: the engine (a queued item starting) and the UI both name worktrees this way. */
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
