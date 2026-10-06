import { describe, expect, it } from 'vitest';
import { dialogKeyAction, type DialogKeyEvent, type DialogKeyState } from './dialogKeys.ts';

const key = (over: Partial<DialogKeyEvent>): DialogKeyEvent => ({ key: 'Escape', metaKey: false, ctrlKey: false, defaultPrevented: false, ...over });
const state = (over: Partial<DialogKeyState> = {}): DialogKeyState => ({ topmost: true, popoverOpen: false, canSubmit: true, ...over });

describe('dialogKeyAction', () => {
  it('closes on Escape', () => {
    expect(dialogKeyAction(key({}), state())).toBe('close');
  });
  it('leaves an Escape a child already handled (a shortcut being recorded)', () => {
    expect(dialogKeyAction(key({ defaultPrevented: true }), state())).toBeNull();
  });
  it('lets an open menu or dropdown take Escape first', () => {
    expect(dialogKeyAction(key({}), state({ popoverOpen: true }))).toBeNull();
  });
  it('only acts for the dialog on top', () => {
    expect(dialogKeyAction(key({}), state({ topmost: false }))).toBeNull();
  });
  it('ignores keys while text is being composed', () => {
    expect(dialogKeyAction(key({ isComposing: true }), state())).toBeNull();
  });
  it('submits on ⌘↵ (or ⌃↵) when the dialog can', () => {
    expect(dialogKeyAction(key({ key: 'Enter', metaKey: true }), state())).toBe('submit');
    expect(dialogKeyAction(key({ key: 'Enter', ctrlKey: true }), state())).toBe('submit');
    expect(dialogKeyAction(key({ key: 'Enter', metaKey: true }), state({ canSubmit: false }))).toBeNull();
    expect(dialogKeyAction(key({ key: 'Enter' }), state())).toBeNull();
  });
});
