import { describe, expect, it } from 'vitest';

// Buttons and shortcuts drift when each screen writes its own classes; Button and Kbd in this folder hold the look.
const SOURCES = import.meta.glob<string>(['../../**/*.tsx', '!./**'], { query: '?raw', import: 'default', eager: true });
const COPIES = [/\bbtn-secondary\b/, /<kbd\b/];

describe('shared components', () => {
  it('are used instead of btn-secondary and <kbd> outside components/ui', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    const offenders = Object.entries(SOURCES).flatMap(([file, text]) =>
      text.split('\n').flatMap((line, i) => (COPIES.some((pattern) => pattern.test(line)) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(offenders, 'Use Button or Kbd from components/ui instead').toEqual([]);
  });
});
