import { describe, expect, it } from 'vitest';

// Buttons, shortcuts, dialogs and radio groups drift when each screen writes its own; the components in this folder hold the look and the keys.
const SOURCES = import.meta.glob<string>(['../../**/*.tsx', '!./**'], { query: '?raw', import: 'default', eager: true });
const COPIES = [/\bbtn-secondary\b/, /<kbd\b/, /\bbg-scrim\b/, /role=["']radiogroup["']/];

describe('shared components', () => {
  it('are used instead of btn-secondary, <kbd>, a dialog scrim or role="radiogroup" outside components/ui', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    const offenders = Object.entries(SOURCES).flatMap(([file, text]) =>
      text.split('\n').flatMap((line, i) => (COPIES.some((pattern) => pattern.test(line)) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(offenders, 'Use Button, Kbd, Dialog, SegmentedControl or RadioGroup from components/ui instead').toEqual([]);
  });
});
