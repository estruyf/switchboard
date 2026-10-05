import { describe, expect, it } from 'vitest';
import { fuzzyScore } from './fuzzy.ts';

describe('fuzzyScore', () => {
  it('matches subsequences, case-insensitively, and rejects the rest', () => {
    expect(fuzzyScore('tt', 'Toggle terminal')).not.toBeNull();
    expect(fuzzyScore('NSES', 'New session')).not.toBeNull();
    expect(fuzzyScore('xyz', 'New session')).toBeNull();
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('ranks word starts and runs above scattered letters', () => {
    const ranked = ['Search conversations', 'Session settings', 'Close the session'].sort((a, b) => fuzzyScore('se', b)! - fuzzyScore('se', a)!);
    expect(ranked[0]).toBe('Session settings');
    expect(fuzzyScore('term', 'Toggle terminal')!).toBeGreaterThan(fuzzyScore('term', 'The early ram')!);
  });
});
