import { describe, expect, it } from 'vitest';
import type { UsageLimit, UsageSnapshot } from '@switchboard/protocol/client';
import { nextUsageEntry, resetLabel, spokenLimit, usageMessage } from './usageFormat.ts';

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

describe('resetLabel', () => {
  it('counts down within a day', () => {
    expect(resetLabel(now + (3 * 60 + 10) * 60_000, now)).toBe('3h 10m');
    expect(resetLabel(now + 2 * 3600_000, now)).toBe('2h');
    expect(resetLabel(now + 45 * 60_000, now)).toBe('45m');
    expect(resetLabel(now + 20_000, now)).toBe('now');
    expect(resetLabel(now - 60_000, now)).toBe('now');
  });
  it('names the weekday from a day out', () => {
    // Wednesday 7 October 2026, local time, and the Monday after it.
    const wednesday = new Date(2026, 9, 7, 9, 0).getTime();
    expect(resetLabel(new Date(2026, 9, 12, 10, 0).getTime(), wednesday, 'en-US')).toBe('Mon');
    expect(resetLabel(wednesday + 24 * 3600_000, wednesday, 'en-US')).toBe('Thu');
    expect(resetLabel(wednesday + 23 * 3600_000 + 59 * 60_000, wednesday, 'en-US')).toBe('23h 59m');
  });
});
