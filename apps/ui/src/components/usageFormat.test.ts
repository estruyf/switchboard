import { describe, expect, it } from 'vitest';
import type { UsageLimit } from '@switchboard/protocol/client';
import { spokenLimit } from './usageFormat.ts';

const limit = (overrides: Partial<UsageLimit>): UsageLimit => ({ kind: 'session', group: 'session', percent: 10, resetsAt: null, scope: null, severity: 'normal', isActive: false, ...overrides });
const now = 1_000_000_000;

describe('spokenLimit', () => {
  it('says which window, how much is used and when it resets', () => {
    expect(spokenLimit(limit({ percent: 6.4, resetsAt: now + 63 * 60_000 }), now)).toBe('5-hour limit: 6% used, resets in 1h3m');
    expect(spokenLimit(limit({ kind: 'weekly_all', group: 'weekly', percent: 81, severity: 'warning' }), now)).toBe('Weekly limit: 81% used, getting close');
    expect(spokenLimit(limit({ kind: 'weekly_fable', group: 'weekly', scope: 'Fable', percent: 97, severity: 'critical' }), now)).toBe('Weekly limit (Fable): 97% used, nearly used up');
  });
});
