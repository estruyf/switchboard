import { describe, expect, it } from 'vitest';
import { attachmentsAfterSend, textAfterSend } from './afterSend.ts';

describe('textAfterSend', () => {
  it('empties the box when nothing changed while sending', () => {
    expect(textAfterSend('fix the tests', 'fix the tests')).toBe('');
    expect(textAfterSend('fix the tests  ', '  fix the tests')).toBe('');
  });

  it('keeps what was typed after the sent text', () => {
    expect(textAfterSend('fix the tests\nand the docs', 'fix the tests')).toBe('and the docs');
    expect(textAfterSend('fix the tests then lint', 'fix the tests')).toBe('then lint');
  });

  it('leaves an edited prompt alone', () => {
    expect(textAfterSend('fix all tests', 'fix the tests')).toBe('fix all tests');
    expect(textAfterSend('', 'fix the tests')).toBe('');
  });
});

describe('attachmentsAfterSend', () => {
  it('removes only the attachments that were sent', () => {
    const a = { name: 'a' };
    const b = { name: 'b' };
    const c = { name: 'c' };
    expect(attachmentsAfterSend([a, b, c], [a, b])).toEqual([c]);
    expect(attachmentsAfterSend([a], [])).toEqual([a]);
  });
});
