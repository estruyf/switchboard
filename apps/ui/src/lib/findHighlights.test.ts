import { describe, expect, it } from 'vitest';
import { matchOffsets } from './findHighlights.ts';

describe('matchOffsets', () => {
  it('finds every occurrence, ignoring case', () => {
    expect(matchOffsets('Fix the Tests, then test again', 'test')).toEqual([
      [8, 12],
      [20, 24],
    ]);
    expect(matchOffsets('aaaa', 'aa')).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(matchOffsets('anything', '')).toEqual([]);
  });

  it('maps offsets back when lower-casing changes the length', () => {
    // 'İ'.toLowerCase() is two code units, which shifted every match after it.
    const text = 'İstanbul ist';
    expect('İ'.toLowerCase()).toHaveLength(2);
    expect(matchOffsets(text, 'ist')).toEqual([[9, 12]]);
    expect(text.slice(9, 12)).toBe('ist');
    // Every offset stays inside the original text, so a Range never goes past its end.
    expect(matchOffsets('xİ', 'İ'.toLowerCase())).toEqual([[1, 2]]);
  });

  it('keeps characters outside the BMP whole', () => {
    expect(matchOffsets('İ 😀 Go', 'go')).toEqual([[5, 7]]);
  });
});
