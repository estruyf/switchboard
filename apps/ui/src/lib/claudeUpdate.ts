import type { ClaudeInstallMethod, ClaudeUpdateState } from '@switchboard/protocol/client';

/** `2.1.10` is newer than `2.1.9`: compared numerically. */
export function newer(a: string, b: string): boolean {
  const parts = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

export const INSTALL_METHOD_LABEL: Record<ClaudeInstallMethod, string> = {
  native: 'Native installer',
  homebrew: 'Homebrew',
  npm: 'npm',
  local: 'Local install (~/.claude/local)',
  unknown: 'Unknown',
};

export interface ClaudeUpdateNotice {
  label: string;
  /** What clicking the notice does: run the update, open Settings → About (the command to copy, the output), or nothing. */
  action: 'update' | 'about' | null;
  /** Whether it has a Dismiss button. */
  dismissible: boolean;
  tone: 'accent' | 'muted' | 'ok';
}

/**
 * The sidebar notice: a newer Claude Code that wasn't dismissed (unless its own auto-updater is turned off,
 * when Settings → About still says so), an update running, or one that just finished.
 */
export function claudeUpdateNotice(state: ClaudeUpdateState | null): ClaudeUpdateNotice | null {
  if (!state) return null;
  if (state.status === 'updating') return { label: 'Updating Claude Code…', action: 'about', dismissible: false, tone: 'muted' };
  if (state.status === 'updated' && state.updatedTo) return { label: `Claude Code updated to v${state.updatedTo}`, action: null, dismissible: true, tone: 'ok' };
  if (state.status !== 'available' || !state.latestVersion || !state.enabled || state.quiet) return null;
  if (state.dismissedVersion && !newer(state.latestVersion, state.dismissedVersion)) return null;
  return { label: `Claude Code v${state.latestVersion} available`, action: state.canUpdate ? 'update' : 'about', dismissible: true, tone: 'accent' };
}

/** One line for Settings → About. */
export function claudeUpdateStatusText(state: ClaudeUpdateState): string {
  switch (state.status) {
    case 'missing':
      return 'Claude Code isn’t installed, or Switchboard can’t find it.';
    case 'off':
      return 'Automatic checks are off.';
    case 'idle':
      return 'Not checked yet.';
    case 'checking':
      return 'Checking for a newer Claude Code…';
    case 'up-to-date':
      return 'Claude Code is up to date.';
    case 'available':
      return `Version ${state.latestVersion} is available${state.channel === 'stable' ? ' on the stable channel' : ''}.`;
    case 'updating':
      return `Updating with ${state.command}…`;
    case 'updated':
      return `Updated to version ${state.updatedTo ?? state.installedVersion}. New sessions use it; sessions already running keep their version until they restart.`;
    case 'error':
      return state.error ?? 'Something went wrong.';
  }
}
