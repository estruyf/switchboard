import { describe, expect, it } from 'vitest';
import { ariaShortcut, formatShortcut, isStoredShortcut, normalizeShortcut, RESERVED_SHORTCUTS, sameShortcut, shortcutFromEvent, shortcutGlyphs, storedShortcut } from './shortcuts.ts';

const press = (key: string, mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}) => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key, ...mods });

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
  it('records + and Space by name, so they can be shown and split', () => {
    expect(shortcutFromEvent(press('+', { metaKey: true, shiftKey: true }))).toBe('cmd+shift+plus');
    expect(shortcutFromEvent(press(' ', { metaKey: true }))).toBe('cmd+space');
    expect(formatShortcut('cmd+shift+plus')).toBe('⌘⇧+');
    expect(formatShortcut('cmd+space')).toBe('⌘Space');
    expect(ariaShortcut('cmd+shift+plus')).toBe('Meta+Shift+Plus');
    expect(ariaShortcut('cmd+space')).toBe('Meta+Space');
    expect(isStoredShortcut('cmd+space')).toBe(true);
    expect(storedShortcut('⌘+')).toBe('cmd+plus');
  });
  it('reads shortcuts saved before + and Space had names', () => {
    expect(normalizeShortcut('cmd+shift++')).toBe('cmd+shift+plus');
    expect(normalizeShortcut('cmd+ ')).toBe('cmd+space');
    expect(normalizeShortcut('cmd+k')).toBe('cmd+k');
    expect(formatShortcut('cmd+shift++')).toBe('⌘⇧+');
    expect(shortcutGlyphs('cmd+ ')).toBe('⌘Space');
    expect(sameShortcut('cmd+shift++', 'cmd+shift+plus')).toBe(true);
    expect(sameShortcut('cmd+k', 'cmd+j')).toBe(false);
  });
  it('treats punctuation keys as stored shortcuts', () => {
    expect(isStoredShortcut('cmd+,')).toBe(true);
    expect(shortcutGlyphs('cmd+\\')).toBe('⌘\\');
    expect(isStoredShortcut('⌘,')).toBe(false);
  });
  it('reserves the app and menu shortcuts', () => {
    for (const key of ['cmd+k', 'cmd+f', 'cmd+g', 'cmd+\\', 'cmd+,', 'cmd+shift+f', 'cmd+shift+h', 'cmd+shift+d', 'cmd+shift+l', 'cmd+enter']) expect(RESERVED_SHORTCUTS.has(key)).toBe(true);
    expect(RESERVED_SHORTCUTS.has(shortcutFromEvent(press('K', { metaKey: true }))!)).toBe(true);
    expect(RESERVED_SHORTCUTS.has(shortcutFromEvent(press(',', { metaKey: true }))!)).toBe(true);
    expect(RESERVED_SHORTCUTS.has('cmd+shift+b')).toBe(false);
  });
});
