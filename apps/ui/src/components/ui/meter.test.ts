import { describe, expect, it } from 'vitest';
import { barWidth, clampPercent, formatPercent, ringDegrees, valueTone } from './meter.ts';

describe('meter', () => {
  it('keeps what it draws and announces to 0–100', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(42.4)).toBe(42.4);
    expect(clampPercent(130)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
  });
  it('shows a whole percentage, an overrun included', () => {
    expect(formatPercent(9.4)).toBe('9%');
    expect(formatPercent(104.2)).toBe('104%');
    expect(formatPercent(Number.NaN)).toBe('–');
  });
  it('gives an almost empty bar a sliver, and never overfills it', () => {
    expect(barWidth(0)).toBe('2%');
    expect(barWidth(50)).toBe('50%');
    expect(barWidth(250)).toBe('100%');
  });
  it('fills a ring by degrees', () => {
    expect(ringDegrees(25)).toBe(90);
    expect(ringDegrees(120)).toBe(360);
  });
  it('colours the value only when the level is not ok', () => {
    expect(valueTone(30)).toBe('');
    expect(valueTone(70)).toBe('text-caution');
    expect(valueTone(90)).toBe('text-error');
  });
});
