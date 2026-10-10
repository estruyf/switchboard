import { describe, expect, it } from 'vitest';
import { randomWorktreeName } from './worktreeName.ts';

describe('randomWorktreeName', () => {
  it('makes three short words that are safe in a branch and folder name', () => {
    for (let i = 0; i < 200; i++) {
      const name = randomWorktreeName();
      expect(name).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
      expect(name.length).toBeLessThanOrEqual(30);
    }
  });

  it('picks from the start and the end of every list', () => {
    expect(randomWorktreeName(() => 0)).toBe('amber-baking-acorn');
    expect(randomWorktreeName(() => 0.999999)).toBe('zesty-zooming-willow');
  });

  it('rarely gives the same name twice', () => {
    const names = new Set(Array.from({ length: 100 }, () => randomWorktreeName()));
    expect(names.size).toBeGreaterThan(90);
  });
});
