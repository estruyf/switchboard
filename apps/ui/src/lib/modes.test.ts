import { describe, expect, it } from 'vitest';
import { tokenAtCaret } from '../components/composer/tokens.ts';
import { nextMode, randomWorktreeName } from './modes.ts';

describe('composer tokens', () => {
  it('detects slash commands and @-mentions at the start or after whitespace', () => {
    expect(tokenAtCaret('/rev', 4)).toEqual({ kind: 'slash', start: 0, query: 'rev' });
    expect(tokenAtCaret('please /rev', 11)).toEqual({ kind: 'slash', start: 7, query: 'rev' });
    expect(tokenAtCaret('first\n/', 7)).toEqual({ kind: 'slash', start: 6, query: '' });
    expect(tokenAtCaret('and/or', 6)).toBeNull();
    expect(tokenAtCaret('see /usr/bin', 12)).toBeNull();
    expect(tokenAtCaret('look at @src/ma', 15)).toEqual({ kind: 'file', start: 8, query: 'src/ma' });
    expect(tokenAtCaret('mail me@example.com', 19)).toBeNull();
    expect(tokenAtCaret('/review now', 11)).toBeNull();
  });
});

describe('modes', () => {
  it('cycles like the CLI', () => {
    expect(nextMode('default')).toBe('acceptEdits');
    expect(nextMode('acceptEdits')).toBe('plan');
    expect(nextMode('plan')).toBe('default');
    expect(nextMode('auto')).toBe('default');
  });

  it('makes up a short worktree name', () => {
    expect(randomWorktreeName(() => 0.5)).toBe('lucky-leaping-lantern');
  });
});
