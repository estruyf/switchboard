import { describe, expect, it } from 'vitest';
import { foldedMeter } from './foldedMeter.ts';

describe('foldedMeter', () => {
  it('lists every number and fills to the fullest', () => {
    expect(foldedMeter([{ label: '5h', percent: 15.2 }, { label: 'Week', percent: 37 }], { percent: 42, detail: '84k / 200k' })).toEqual({
      percent: 42,
      lines: ['5h 15%', 'Week 37%', 'Context 42% · 84k / 200k'],
    });
  });
  it('shows a limit that runs out even when the context is low', () => {
    expect(foldedMeter([{ label: '5h', percent: 91 }], { percent: 12, detail: '24k / 200k' })?.percent).toBe(91);
  });
  it('says an estimate is one and fills only from usage', () => {
    expect(foldedMeter([{ label: '5h', percent: 9 }], { percent: null, detail: '≈46k' })).toEqual({ percent: 9, lines: ['5h 9%', 'Context ≈46k'] });
  });
  it('has no fill with only an estimate, and nothing at all without numbers', () => {
    expect(foldedMeter([], { percent: null, detail: '≈46k' })).toEqual({ percent: null, lines: ['Context ≈46k'] });
    expect(foldedMeter([], null)).toBeNull();
  });
});
