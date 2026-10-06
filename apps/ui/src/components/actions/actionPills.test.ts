import { describe, expect, it } from 'vitest';
import { MAX_ACTION_PILLS, splitActionPills } from './actionPills.ts';

describe('splitActionPills', () => {
  it('shows no pills without actions', () => {
    expect(splitActionPills([])).toEqual({ pills: [], more: [] });
  });

  it('shows every action as a pill up to the limit', () => {
    expect(splitActionPills(['a', 'b', 'c'])).toEqual({ pills: ['a', 'b', 'c'], more: [] });
  });

  it('puts the actions past the limit behind "more"', () => {
    expect(splitActionPills(['a', 'b', 'c', 'd', 'e'])).toEqual({ pills: ['a', 'b', 'c'], more: ['d', 'e'] });
  });

  it('defaults to three pills', () => {
    expect(MAX_ACTION_PILLS).toBe(3);
    expect(splitActionPills(['a', 'b'], 1)).toEqual({ pills: ['a'], more: ['b'] });
  });
});
