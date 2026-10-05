import { describe, expect, it } from 'vitest';

// Native dropdowns, checkboxes and radios ignore the theme; the shared components in this folder replace them.
const SOURCES = import.meta.glob<string>(['../../**/*.{ts,tsx}', '!../../**/*.test.ts', '!./**'], { query: '?raw', import: 'default', eager: true });
const NATIVE = [/<select\b/, /type=["']checkbox["']/, /type=["']radio["']/];

describe('native form controls', () => {
  it('are only used inside components/ui', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    const offenders = Object.entries(SOURCES).flatMap(([file, text]) =>
      text.split('\n').flatMap((line, i) => (NATIVE.some((pattern) => pattern.test(line)) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(offenders, 'Use Select, Checkbox or Radio from components/ui instead').toEqual([]);
  });
});
