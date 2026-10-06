import type { AppInfo, UpdateState } from '@switchboard/protocol/bridge';

/** `v0.0.3`, or `dev · 1a2b3c4` so a development build is never mistaken for a release. */
export function versionLabel(info: AppInfo): string {
  if (info.dev) return info.commit ? `dev · ${info.commit}` : 'dev';
  return `v${info.version}`;
}

export interface UpdatePill {
  label: string;
  /** What clicking the pill does; null while it's busy. */
  action: 'download' | 'install' | 'retry' | 'dismiss' | null;
  tone: 'accent' | 'muted' | 'error' | 'ok';
}

/**
 * The sidebar pill: only when there is something to act on or to know. Background check failures
 * (offline, say) stay in Settings → About; a failed download or install shows here, since you started it.
 */
export function updatePill(state: UpdateState | null): UpdatePill | null {
  if (!state) return null;
  switch (state.status) {
    case 'available':
      return { label: `Update available (v${state.availableVersion})`, action: 'download', tone: 'accent' };
    case 'downloading':
      return { label: `Downloading… ${state.downloadPercent ?? 0}%`, action: null, tone: 'muted' };
    case 'downloaded':
      return { label: 'Restart to update', action: 'install', tone: 'accent' };
    case 'installing':
      return { label: 'Restarting…', action: null, tone: 'muted' };
    case 'error':
      if (state.availableVersion || state.downloadedVersion) return { label: 'Update failed', action: state.canRetry ? 'retry' : null, tone: 'error' };
      break;
  }
  if (state.updatedTo) return { label: `Updated to v${state.updatedTo}`, action: 'dismiss', tone: 'ok' };
  return null;
}

/** One line for Settings → About. */
export function updateStatusText(state: UpdateState): string {
  switch (state.status) {
    case 'disabled':
      return state.disabledReason ?? 'Updates are turned off.';
    case 'idle':
      return 'Not checked yet.';
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return 'Switchboard is up to date.';
    case 'available':
      return `Version ${state.availableVersion} is available.`;
    case 'downloading':
      return `Downloading version ${state.availableVersion}… ${state.downloadPercent ?? 0}%`;
    case 'downloaded':
      return `Version ${state.downloadedVersion} is ready. Restart Switchboard to install it.`;
    case 'installing':
      return 'Restarting to install the update…';
    case 'error':
      return `The update failed: ${state.error ?? 'unknown error'}`;
  }
}

/** "Last checked 5 minutes ago". */
export function lastChecked(checkedAt: number | null, now = Date.now()): string {
  if (checkedAt === null) return 'Never checked';
  const minutes = Math.floor(Math.max(0, now - checkedAt) / 60_000);
  if (minutes < 1) return 'Last checked just now';
  if (minutes < 60) return `Last checked ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last checked ${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `Last checked ${new Date(checkedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
