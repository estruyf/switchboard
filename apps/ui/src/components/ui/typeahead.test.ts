import { describe, expect, it } from 'vitest';
import { nextTypeaheadIndex } from './typeahead.ts';

const options = [{ label: 'Low effort' }, { label: 'Medium effort' }, { label: 'High effort' }, { label: 'Max effort' }, { label: 'Most', disabled: true }];

describe('nextTypeaheadIndex', () => {
  it('finds the next option starting with a letter', () => {
    expect(nextTypeaheadIndex(options, 'h', 0)).toBe(2);
    expect(nextTypeaheadIndex(options, 'M', 0)).toBe(1);
  });

  it('cycles through options with the same first letter and skips disabled ones', () => {
    expect(nextTypeaheadIndex(options, 'm', 1)).toBe(3);
    expect(nextTypeaheadIndex(options, 'mm', 3)).toBe(1);
  });

  it('keeps the current option while a longer query still matches it', () => {
    expect(nextTypeaheadIndex(options, 'ma', 3)).toBe(3);
    expect(nextTypeaheadIndex(options, 'hig', 0)).toBe(2);
  });

  it('returns -1 when nothing matches', () => {
    expect(nextTypeaheadIndex(options, 'z', 0)).toBe(-1);
  });
});
