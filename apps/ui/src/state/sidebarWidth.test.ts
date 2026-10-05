import { describe, expect, it } from 'vitest';
import { clampSidebarWidth, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from './sidebarWidth.ts';

describe('clampSidebarWidth', () => {
  it('keeps widths inside the limits', () => {
    expect(clampSidebarWidth(100)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(2000)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(361.6)).toBe(362);
  });

  it('falls back to the default for nonsense', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});
