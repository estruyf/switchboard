import { describe, expect, it } from 'vitest';
import { ariaShortcut, isStoredShortcut, shortcutGlyphs, storedShortcut } from './shortcuts.ts';

describe('shortcuts', () => {
  it('tells a stored shortcut from glyphs', () => {
    expect(isStoredShortcut('cmd+enter')).toBe(true);
    expect(isStoredShortcut('escape')).toBe(true);
    expect(isStoredShortcut('⌘↵')).toBe(false);
    expect(isStoredShortcut('Esc')).toBe(false);
  });
  it('shows glyphs as given and formats a stored shortcut', () => {
    expect(shortcutGlyphs('⌘↵')).toBe('⌘↵');
    expect(shortcutGlyphs('cmd+shift+p')).toBe('⌘⇧P');
    expect(shortcutGlyphs('escape')).toBe('Esc');
  });
  it('reads glyphs back as a stored shortcut', () => {
    expect(storedShortcut('⌘↵')).toBe('cmd+enter');
    expect(storedShortcut('⌘⇧H')).toBe('cmd+shift+h');
    expect(storedShortcut('⌃1')).toBe('ctrl+1');
    expect(storedShortcut('⌘⌫')).toBe('cmd+backspace');
    expect(storedShortcut('Esc')).toBe('escape');
    expect(storedShortcut('cmd+n')).toBe('cmd+n');
  });
  it('spells a shortcut the way aria-keyshortcuts wants it', () => {
    expect(ariaShortcut('cmd+shift+p')).toBe('Meta+Shift+P');
    expect(ariaShortcut(storedShortcut('⌘↵'))).toBe('Meta+Enter');
    expect(ariaShortcut(storedShortcut('Esc'))).toBe('Escape');
    expect(ariaShortcut(storedShortcut('⌃1'))).toBe('Control+1');
  });
});
