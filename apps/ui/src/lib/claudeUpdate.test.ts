import { describe, expect, it } from 'vitest';
import type { ClaudeUpdateState } from '@switchboard/protocol/client';
import { claudeUpdateNotice, claudeUpdateStatusText } from './claudeUpdate.ts';

const base: ClaudeUpdateState = {
  status: 'available',
  enabled: true,
  path: '/Users/me/.local/bin/claude',
  installedVersion: '2.1.0',
  latestVersion: '2.2.0',
  channel: 'latest',
  method: 'native',
  command: 'claude update',
  canUpdate: true,
  manualReason: null,
  quiet: false,
  dismissedVersion: null,
  checkedAt: 1,
  error: null,
  output: '',
  updatedTo: null,
};

describe('claudeUpdateNotice', () => {
  it('offers an update Switchboard can run, or opens About for one it can’t', () => {
    expect(claudeUpdateNotice(base)).toMatchObject({ label: 'Claude Code v2.2.0 available', action: 'update', dismissible: true });
    expect(claudeUpdateNotice({ ...base, canUpdate: false })?.action).toBe('about');
  });

  it('stays hidden after dismissing, until a newer version', () => {
    expect(claudeUpdateNotice({ ...base, dismissedVersion: '2.2.0' })).toBeNull();
    expect(claudeUpdateNotice({ ...base, dismissedVersion: '2.1.9' })).not.toBeNull();
    expect(claudeUpdateNotice({ ...base, latestVersion: '2.10.0', dismissedVersion: '2.9.0' })).not.toBeNull();
  });

  it('doesn’t nag when checks are off or Claude Code’s own updater is turned off', () => {
    expect(claudeUpdateNotice({ ...base, enabled: false })).toBeNull();
    expect(claudeUpdateNotice({ ...base, quiet: true })).toBeNull();
    expect(claudeUpdateNotice({ ...base, status: 'up-to-date' })).toBeNull();
    expect(claudeUpdateNotice(null)).toBeNull();
  });

  it('shows an update running, and one that finished until dismissed', () => {
    expect(claudeUpdateNotice({ ...base, status: 'updating', quiet: true })).toMatchObject({ action: 'about', dismissible: false });
    expect(claudeUpdateNotice({ ...base, status: 'updated', updatedTo: '2.2.0' })).toMatchObject({ label: 'Claude Code updated to v2.2.0', dismissible: true });
  });
});

describe('claudeUpdateStatusText', () => {
  it('says what new and running sessions use after an update', () => {
    expect(claudeUpdateStatusText({ ...base, status: 'updated', updatedTo: '2.2.0' })).toContain('New sessions use it');
    expect(claudeUpdateStatusText({ ...base, channel: 'stable' })).toBe('Version 2.2.0 is available on the stable channel.');
    expect(claudeUpdateStatusText({ ...base, status: 'error', error: 'offline' })).toBe('offline');
  });
});
