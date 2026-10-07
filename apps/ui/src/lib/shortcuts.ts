/**
 * App shortcuts that actions may not take over: Switchboard's own (App.tsx, the session view, the
 * sidebar, Find, git), the menu bar's (apps/desktop/src/main/index.ts and the standard Edit, View and
 * Window menus) and the terminal's ⌃C. Menu shortcuts never reach the page, so an action on one would
 * never run.
 */
export const RESERVED_SHORTCUTS = new Set([
  // Switchboard
  'cmd+n',
  'cmd+o',
  'cmd+j',
  'cmd+k',
  'cmd+f',
  'cmd+g',
  'cmd+shift+g',
  'cmd+\\',
  'cmd+enter',
  'cmd+backspace',
  'cmd+shift+f',
  'cmd+shift+h',
  'cmd+shift+d',
  'cmd+shift+l',
  // Menu bar: Settings, Quit, Hide, Edit, View and Window
  'cmd+,',
  'cmd+q',
  'cmd+h',
  'cmd+alt+h',
  'cmd+c',
  'cmd+v',
  'cmd+x',
  'cmd+a',
  'cmd+z',
  'cmd+shift+z',
  'cmd+alt+shift+v',
  'cmd+w',
  'cmd+m',
  'cmd+r',
  'cmd+shift+r',
  'cmd+alt+i',
  'cmd+0',
  'cmd+=',
  'cmd+plus',
  'cmd+shift+plus',
  'cmd+-',
  'cmd+ctrl+f',
  // The terminal
  'ctrl+c',
]);

/** Keys that can't be written as themselves in the `+`-joined form. */
const NAMED_KEYS: Record<string, string> = { '+': 'plus', ' ': 'space' };

/** `cmd+shift+p` from a key event, or null for a bare modifier press. */
export function shortcutFromEvent(event: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; key: string; code?: string }): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return null;
  // Option changes the character on macOS (⌥P = π); use the physical key instead.
  const raw = event.altKey && event.code?.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
  const key = NAMED_KEYS[raw] ?? raw;
  return [event.metaKey && 'cmd', event.ctrlKey && 'ctrl', event.altKey && 'alt', event.shiftKey && 'shift', key].filter(Boolean).join('+');
}

/**
 * A stored shortcut in today's form. Earlier versions saved `+` and Space as themselves
 * (`cmd+shift++`, `cmd+ `), which can't be split on `+`; those read as `plus` and `space`.
 */
export function normalizeShortcut(shortcut: string): string {
  if (shortcut === '+' || shortcut.endsWith('++')) return `${shortcut.slice(0, -1)}plus`;
  if (shortcut === ' ' || shortcut.endsWith('+ ')) return `${shortcut.slice(0, -1)}space`;
  return shortcut;
}

const KEY_GLYPHS: Record<string, string> = {
  cmd: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
  enter: '↩',
  backspace: '⌫',
  escape: 'Esc',
  plus: '+',
  space: 'Space',
  tab: '⇥',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

/** `cmd+shift+p` as macOS shows it: `⌘⇧P`. */
export function formatShortcut(shortcut: string): string {
  return normalizeShortcut(shortcut)
    .split('+')
    .map((part) => KEY_GLYPHS[part] ?? part.toUpperCase())
    .join('');
}

const ARIA_KEYS: Record<string, string> = {
  cmd: 'Meta',
  ctrl: 'Control',
  alt: 'Alt',
  shift: 'Shift',
  enter: 'Enter',
  backspace: 'Backspace',
  escape: 'Escape',
  plus: 'Plus',
  space: 'Space',
  tab: 'Tab',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
};

/** `cmd+shift+p` as `aria-keyshortcuts` spells it (`Meta+Shift+P`), so VoiceOver can announce an action's shortcut. */
export function ariaShortcut(shortcut: string): string {
  return normalizeShortcut(shortcut)
    .split('+')
    .map((part) => ARIA_KEYS[part] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join('+');
}

/** Modifiers, then a named key (`enter`, `p`, `1`) or one ASCII punctuation character other than `+` (`,`, `\`). */
const STORED = /^(?:(?:cmd|ctrl|alt|shift)\+)*(?:[a-z0-9]+|[!-*,-\/:-@\[-`{-~])$/;

/** A stored shortcut (`cmd+enter`, `escape`, `cmd+,`) as opposed to glyphs typed for display (`⌘↵`, `Esc`). */
export const isStoredShortcut = (keys: string) => STORED.test(normalizeShortcut(keys));

const GLYPH_MODIFIERS: Record<string, string> = { '⌘': 'cmd', '⌃': 'ctrl', '⌥': 'alt', '⇧': 'shift' };
const GLYPH_KEYS: Record<string, string> = { '↵': 'enter', '↩': 'enter', '⌫': 'backspace', esc: 'escape', '↑': 'arrowup', '↓': 'arrowdown', '+': 'plus', '⇥': 'tab' };

/**
 * Glyphs as people read them (`⌘↵`, `⌘⇧H`, `Esc`) back to the stored form (`cmd+enter`, `cmd+shift+h`,
 * `escape`), so a button that shows `⌘↵` can also announce it. A stored shortcut comes back in today's form.
 */
export function storedShortcut(keys: string): string {
  if (isStoredShortcut(keys)) return normalizeShortcut(keys);
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

/** Whether two stored shortcuts are the same keys, reading older forms the way they are read today. */
export const sameShortcut = (a: string, b: string) => normalizeShortcut(a) === normalizeShortcut(b);
