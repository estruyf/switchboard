import { describe, expect, it } from 'vitest';
import { commandToRun, isRunnable } from './runnable.ts';

describe('isRunnable', () => {
  it('runs shell blocks only', () => {
    expect(isRunnable('bash')).toBe(true);
    expect(isRunnable('Shell')).toBe(true);
    expect(isRunnable('zsh')).toBe(true);
    expect(isRunnable('ts')).toBe(false);
    expect(isRunnable(undefined)).toBe(false);
  });
});

describe('commandToRun', () => {
  it('keeps a plain script as written, without blank lines', () => {
    expect(commandToRun('git status\n\ngit log -1  \n')).toBe('git status\ngit log -1');
  });

  it('keeps continuation lines', () => {
    expect(commandToRun('git -C ~/repo worktree remove \\\n  ../ci')).toBe('git -C ~/repo worktree remove \\\n  ../ci');
  });

  it('takes only the prompt lines of a transcript', () => {
    expect(commandToRun('$ npm test\n> 3 passed\n$ git push')).toBe('npm test\ngit push');
  });

  it('is empty when there is nothing to run', () => {
    expect(commandToRun('\n  \n')).toBe('');
  });
});
