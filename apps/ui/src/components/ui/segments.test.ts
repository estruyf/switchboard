import { describe, expect, it } from 'vitest';
import { stepSegment } from './segments.ts';

const all = [true, true, true];

describe('stepSegment', () => {
  it('moves with the arrow keys and wraps round', () => {
    expect(stepSegment('ArrowRight', 0, all)).toBe(1);
    expect(stepSegment('ArrowDown', 2, all)).toBe(0);
    expect(stepSegment('ArrowLeft', 0, all)).toBe(2);
    expect(stepSegment('ArrowUp', 1, all)).toBe(0);
  });
  it('jumps to the ends with Home and End', () => {
    expect(stepSegment('Home', 2, all)).toBe(0);
    expect(stepSegment('End', 0, all)).toBe(2);
  });
  it('skips disabled segments', () => {
    expect(stepSegment('ArrowRight', 0, [true, false, true])).toBe(2);
    expect(stepSegment('Home', 2, [false, true, true])).toBe(1);
  });
  it('starts at an end when nothing is chosen', () => {
    expect(stepSegment('ArrowRight', -1, all)).toBe(0);
    expect(stepSegment('ArrowLeft', -1, all)).toBe(2);
  });
  it('ignores other keys, and a group with nothing to choose', () => {
    expect(stepSegment('Enter', 0, all)).toBeNull();
    expect(stepSegment('ArrowRight', 0, [false, false])).toBeNull();
  });
});
