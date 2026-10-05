import { describe, expect, it } from 'vitest';
import { basename, guessHome, shortAge, tildify } from './format.ts';

describe('format', () => {
  const now = Date.UTC(2026, 9, 5, 12, 0, 0);
  it('formats ages compactly', () => {
    expect(shortAge(now - 10_000, now)).toBe('now');
    expect(shortAge(now - 5 * 60_000, now)).toBe('5m');
    expect(shortAge(now - 3 * 3_600_000, now)).toBe('3h');
    expect(shortAge(now - 2 * 86_400_000, now)).toBe('2d');
    expect(shortAge(now + 60_000, now)).toBe('now');
  });

  it('handles paths', () => {
    expect(basename('/Users/me/dev/app/')).toBe('app');
    expect(guessHome(['/tmp/x', '/Users/me/dev/app'])).toBe('/Users/me');
    expect(tildify('/Users/me/dev/app', '/Users/me')).toBe('~/dev/app');
    expect(tildify('/Users/meow/app', '/Users/me')).toBe('/Users/meow/app');
  });
});
