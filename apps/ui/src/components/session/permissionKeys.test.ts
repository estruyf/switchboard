import { describe, expect, it } from 'vitest';
import { cardKeyAction, waitingLabel, type KeyLike } from './permissionKeys.ts';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe('cardKeyAction', () => {
  it('allows with ⌘↵ or Ctrl+Enter from the composer or nowhere', () => {
    expect(cardKeyAction(key('Enter', { metaKey: true }), 'composer', 'tool')).toEqual({ type: 'allow' });
    expect(cardKeyAction(key('Enter', { ctrlKey: true }), 'body', 'plan')).toEqual({ type: 'allow' });
  });

  it('denies with Escape', () => {
    expect(cardKeyAction(key('Escape'), 'composer', 'tool')).toEqual({ type: 'deny' });
    expect(cardKeyAction(key('Escape'), 'card-field', 'tool')).toEqual({ type: 'deny' });
    expect(cardKeyAction(key('Escape'), 'card-field', 'question')).toBeNull();
  });

  it('leaves other fields alone', () => {
    expect(cardKeyAction(key('Escape'), 'field', 'tool')).toBeNull();
    expect(cardKeyAction(key('Enter', { metaKey: true }), 'field', 'tool')).toBeNull();
  });

  it('does not approve from the tool card feedback field', () => {
    expect(cardKeyAction(key('Enter', { metaKey: true }), 'card-field', 'tool')).toBeNull();
    expect(cardKeyAction(key('Enter', { metaKey: true }), 'card-field', 'question')).toEqual({ type: 'allow' });
  });

  it('ignores Escape with modifiers and while composing', () => {
    expect(cardKeyAction(key('Escape', { shiftKey: true }), 'body', 'tool')).toBeNull();
    expect(cardKeyAction(key('Escape', { isComposing: true }), 'body', 'tool')).toBeNull();
  });

  it('picks question options with number keys outside text fields', () => {
    expect(cardKeyAction(key('2'), 'body', 'question', 3)).toEqual({ type: 'pick', index: 1 });
    expect(cardKeyAction(key('4'), 'body', 'question', 3)).toBeNull();
    expect(cardKeyAction(key('1'), 'composer', 'question', 3)).toBeNull();
    expect(cardKeyAction(key('1'), 'card-field', 'question', 3)).toBeNull();
    expect(cardKeyAction(key('1'), 'body', 'tool', 3)).toBeNull();
  });

  it('moves on with Enter from an option or nowhere, not from the composer', () => {
    expect(cardKeyAction(key('Enter'), 'card-option', 'question', 2)).toEqual({ type: 'enter' });
    expect(cardKeyAction(key('Enter'), 'body', 'question', 2)).toEqual({ type: 'enter' });
    expect(cardKeyAction(key('Enter'), 'composer', 'question', 2)).toBeNull();
    expect(cardKeyAction(key('Enter'), 'card', 'question', 2)).toBeNull();
  });
});

describe('waitingLabel', () => {
  it('says nothing in the first minute, then minutes, hours, days', () => {
    expect(waitingLabel(0, 30_000)).toBeNull();
    expect(waitingLabel(0, 2 * 60_000)).toBe('Waiting 2m');
    expect(waitingLabel(0, 3 * 3_600_000)).toBe('Waiting 3h');
    expect(waitingLabel(0, 2 * 86_400_000)).toBe('Waiting 2d');
  });
});
