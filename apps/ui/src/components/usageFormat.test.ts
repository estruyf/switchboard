import { describe, expect, it } from 'vitest';
import type { UsageLimit, UsageSnapshot } from '@switchboard/protocol/client';
import { nextUsageEntry, spokenLimit, usageMessage } from './usageFormat.ts';

const limit = (overrides: Partial<UsageLimit>): UsageLimit => ({ kind: 'session', group: 'session', percent: 10, resetsAt: null, scope: null, severity: 'normal', isActive: false, ...overrides });
const now = 1_000_000_000;

describe('spokenLimit', () => {
  it('says which window, how much is used and when it resets', () => {
    expect(spokenLimit(limit({ percent: 6.4, resetsAt: now + 63 * 60_000 }), now)).toBe('5-hour limit: 6% used, resets in 1h3m');
    expect(spokenLimit(limit({ kind: 'weekly_all', group: 'weekly', percent: 81, severity: 'warning' }), now)).toBe('Weekly limit: 81% used, getting close');
    expect(spokenLimit(limit({ kind: 'weekly_fable', group: 'weekly', scope: 'Fable', percent: 97, severity: 'critical' }), now)).toBe('Weekly limit (Fable): 97% used, nearly used up');
  });
});

describe('nextUsageEntry', () => {
  const snapshot = { limits: [limit({})] } as unknown as UsageSnapshot;
  it('stores new numbers and clears an earlier error', () => {
    expect(nextUsageEntry({ usage: null, error: 'offline' }, { usage: snapshot, error: null })).toEqual({ usage: snapshot, error: null });
  });
  it('keeps the numbers already shown when a refresh fails', () => {
    expect(nextUsageEntry({ usage: snapshot, error: null }, { usage: null, error: 'offline' })).toEqual({ usage: snapshot, error: 'offline' });
  });
  it('tells a failed first fetch from one with no data', () => {
    expect(nextUsageEntry(undefined, { usage: null, error: 'Not logged in' })).toEqual({ usage: null, error: 'Not logged in' });
    expect(nextUsageEntry(undefined, { usage: null })).toEqual({ usage: null, error: null });
  });
});

describe('usageMessage', () => {
  it('says loading only until the first answer', () => {
    expect(usageMessage(undefined)).toBe('Loading usage…');
    expect(usageMessage({ usage: null, error: 'Not logged in' })).toBe('Usage unavailable');
    expect(usageMessage({ usage: null, error: null })).toBe('No plan limits reported.');
  });
});
