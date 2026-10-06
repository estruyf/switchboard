/** App shortcuts that actions may not take over. */
export const RESERVED_SHORTCUTS = new Set(['cmd+n', 'cmd+o', 'cmd+j', 'cmd+backspace', 'cmd+c', 'cmd+v', 'cmd+x', 'cmd+a', 'cmd+z', 'cmd+shift+z', 'cmd+q', 'cmd+w', 'cmd+r', 'cmd+shift+l', 'ctrl+c']);

/** `cmd+shift+p` from a key event, or null for a bare modifier press. */
export function shortcutFromEvent(event: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; key: string; code?: string }): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return null;
  // Option changes the character on macOS (⌥P = π); use the physical key instead.
  const key = event.altKey && event.code?.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
  return [event.metaKey && 'cmd', event.ctrlKey && 'ctrl', event.altKey && 'alt', event.shiftKey && 'shift', key].filter(Boolean).join('+');
}

/** `cmd+shift+p` as macOS shows it: `⌘⇧P`. */
export function formatShortcut(shortcut: string): string {
  const symbols: Record<string, string> = { cmd: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧', enter: '↩', backspace: '⌫', escape: 'Esc' };
  return shortcut
    .split('+')
    .map((part) => symbols[part] ?? part.toUpperCase())
    .join('');
}

const ARIA_KEYS: Record<string, string> = { cmd: 'Meta', ctrl: 'Control', alt: 'Alt', shift: 'Shift', enter: 'Enter', backspace: 'Backspace', escape: 'Escape', arrowup: 'ArrowUp', arrowdown: 'ArrowDown' };

/** `cmd+shift+p` as `aria-keyshortcuts` spells it (`Meta+Shift+P`), so VoiceOver can announce an action's shortcut. */
export function ariaShortcut(shortcut: string): string {
  return shortcut
    .split('+')
    .map((part) => ARIA_KEYS[part] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join('+');
}

/** A stored shortcut (`cmd+enter`, `escape`) as opposed to glyphs typed for display (`⌘↵`, `Esc`). */
export const isStoredShortcut = (keys: string) => /^[a-z0-9]+(\+[a-z0-9]+)*$/.test(keys);

const GLYPH_MODIFIERS: Record<string, string> = { '⌘': 'cmd', '⌃': 'ctrl', '⌥': 'alt', '⇧': 'shift' };
const GLYPH_KEYS: Record<string, string> = { '↵': 'enter', '↩': 'enter', '⌫': 'backspace', esc: 'escape', '↑': 'arrowup', '↓': 'arrowdown' };

/**
 * Glyphs as people read them (`⌘↵`, `⌘⇧H`, `Esc`) back to the stored form (`cmd+enter`, `cmd+shift+h`,
 * `escape`), so a button that shows `⌘↵` can also announce it. A stored shortcut comes back unchanged.
 */
export function storedShortcut(keys: string): string {
  if (isStoredShortcut(keys)) return keys;
  const parts: string[] = [];
  let rest = keys;
  while (rest && GLYPH_MODIFIERS[rest[0]!]) {
    parts.push(GLYPH_MODIFIERS[rest[0]!]!);
    rest = rest.slice(1);
  }
  const key = rest.toLowerCase();
  if (key) parts.push(GLYPH_KEYS[key] ?? key);
  return parts.join('+');
}

/** What a `<kbd>` shows for either form: glyphs stay as they are, a stored shortcut is formatted. */
export const shortcutGlyphs = (keys: string) => (isStoredShortcut(keys) ? formatShortcut(keys) : keys);
