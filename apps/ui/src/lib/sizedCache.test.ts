import { describe, expect, it } from 'vitest';
import { SizedCache } from './sizedCache.ts';

describe('SizedCache', () => {
  it('keeps entries within the character budget, dropping the least recently used', () => {
    const cache = new SizedCache(10);
    cache.set('a', '1234'); // 5
    cache.set('b', '1234'); // 10
    expect(cache.used).toBe(10);
    expect(cache.get('a')).toBe('1234'); // a is now the most recent
    cache.set('c', '12'); // 3: b goes
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('1234');
    expect(cache.get('c')).toBe('12');
    expect(cache.used).toBe(8);
  });

  it('replaces an entry without counting it twice', () => {
    const cache = new SizedCache(100);
    cache.set('a', 'x'.repeat(10));
    cache.set('a', 'y');
    expect(cache.size).toBe(1);
    expect(cache.used).toBe(2);
  });

  it('never keeps an entry bigger than the budget', () => {
    const cache = new SizedCache(5);
    cache.set('a', '1');
    cache.set('big', '123456');
    expect(cache.get('big')).toBeUndefined();
    expect(cache.get('a')).toBe('1');
  });
});
