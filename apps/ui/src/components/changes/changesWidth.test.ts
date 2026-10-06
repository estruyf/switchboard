import { describe, expect, it } from 'vitest';
import { CHANGES_DEFAULT_WIDTH, CHANGES_KEY_STEP, CHANGES_MIN_WIDTH, changesWidthForKey, clampChangesWidth } from './changesWidth.ts';

describe('clampChangesWidth', () => {
  it('keeps a width within the limits as it is, rounded', () => {
    expect(clampChangesWidth(500.4, 1400)).toBe(500);
  });
  it('never goes below the minimum', () => {
    expect(clampChangesWidth(100, 1400)).toBe(CHANGES_MIN_WIDTH);
  });
  it('takes at most 70% of the window', () => {
    expect(clampChangesWidth(2000, 1000)).toBe(700);
  });
  it('keeps the minimum in a window too small for it', () => {
    expect(clampChangesWidth(600, 300)).toBe(CHANGES_MIN_WIDTH);
  });
  it('falls back to the default for a bad value', () => {
    expect(clampChangesWidth(Number.NaN, 1400)).toBe(CHANGES_DEFAULT_WIDTH);
  });
});

describe('changesWidthForKey', () => {
  it('widens with ← and narrows with →', () => {
    expect(changesWidthForKey('ArrowLeft', 440, 1400)).toBe(440 + CHANGES_KEY_STEP);
    expect(changesWidthForKey('ArrowRight', 440, 1400)).toBe(440 - CHANGES_KEY_STEP);
  });
  it('stays within the limits', () => {
    expect(changesWidthForKey('ArrowRight', CHANGES_MIN_WIDTH, 1400)).toBe(CHANGES_MIN_WIDTH);
  });
  it('ignores other keys', () => {
    expect(changesWidthForKey('ArrowUp', 440, 1400)).toBeNull();
  });
});
