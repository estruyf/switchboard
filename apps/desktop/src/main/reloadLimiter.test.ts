import { describe, expect, it } from 'vitest';
import { ReloadLimiter } from './reloadLimiter.ts';

describe('ReloadLimiter', () => {
  it('reloads after a crash, at most three times a minute, and never after a clean exit', () => {
    const limiter = new ReloadLimiter();
    expect(limiter.shouldReload('clean-exit', 0)).toBe(false);
    expect(limiter.shouldReload('crashed', 0)).toBe(true);
    expect(limiter.shouldReload('oom', 10_000)).toBe(true);
    expect(limiter.shouldReload('killed', 20_000)).toBe(true);
    expect(limiter.shouldReload('crashed', 30_000)).toBe(false);
    // A minute after the first reload, one more is allowed.
    expect(limiter.shouldReload('crashed', 60_000)).toBe(true);
    expect(limiter.shouldReload('crashed', 60_001)).toBe(false);
  });
});
