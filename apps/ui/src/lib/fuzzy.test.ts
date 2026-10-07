import { describe, expect, it } from 'vitest';
import { fuzzyMatch, fuzzyScore } from './fuzzy.ts';

describe('fuzzyMatch', () => {
  it('returns the positions of the matched letters, for highlighting', () => {
    expect(fuzzyMatch('tt', 'Toggle terminal')?.indices).toEqual([0, 7]);
    expect(fuzzyMatch('new', 'New session')?.indices).toEqual([0, 1, 2]);
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] });
    expect(fuzzyMatch('zz', 'New session')).toBeNull();
  });
});

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
