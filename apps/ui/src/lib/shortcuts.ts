/** App shortcuts that actions may not take over. */
export const RESERVED_SHORTCUTS = new Set(['cmd+n', 'cmd+o', 'cmd+j', 'cmd+backspace', 'cmd+c', 'cmd+v', 'cmd+x', 'cmd+a', 'cmd+z', 'cmd+shift+z', 'cmd+q', 'cmd+w', 'cmd+r', 'ctrl+c']);

/** `cmd+shift+p` from a key event, or null for a bare modifier press. */
export function shortcutFromEvent(event: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; key: string; code?: string }): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return null;
  // Option changes the character on macOS (⌥P = π); use the physical key instead.
  const key = event.altKey && event.code?.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
  return [event.metaKey && 'cmd', event.ctrlKey && 'ctrl', event.altKey && 'alt', event.shiftKey && 'shift', key].filter(Boolean).join('+');
}

export function formatShortcut(shortcut: string): string {
  const symbols: Record<string, string> = { cmd: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧', enter: '↩', backspace: '⌫' };
  return shortcut
    .split('+')
    .map((part) => symbols[part] ?? part.toUpperCase())
    .join('');
}
