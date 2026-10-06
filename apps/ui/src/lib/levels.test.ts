import { describe, expect, it } from 'vitest';
import { levelOf } from './levels.ts';

describe('levelOf', () => {
  it('is ok below 60%', () => {
    expect(levelOf(0)).toBe('ok');
    expect(levelOf(59.9)).toBe('ok');
  });
  it('is caution from 60% to just under 85%', () => {
    expect(levelOf(60)).toBe('caution');
    expect(levelOf(84.9)).toBe('caution');
  });
  it('is high from 85% on', () => {
    expect(levelOf(85)).toBe('high');
    expect(levelOf(120)).toBe('high');
  });
  it('treats a missing number as ok', () => {
    expect(levelOf(Number.NaN)).toBe('ok');
  });
});
