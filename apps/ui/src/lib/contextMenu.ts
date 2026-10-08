import { matches } from './shortcuts.ts';

/** Where a context menu opens: `above` puts its bottom edge at `y` (see `Menu`). */
export interface ContextMenuPoint {
  x: number;
  y: number;
  above: boolean;
}

/** Shift+F10 or the context-menu key: opens an element's context menu from the keyboard, as a right-click does. */
export const isContextMenuKey = (event: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }) => event.key === 'ContextMenu' || matches(event, 'context-menu');

/**
 * Where to open a context menu: at the pointer for a right-click, at the element for the keyboard
 * (`pointer` null). In the lower half of the window it opens upwards, so it doesn't run off the bottom.
 */
export function contextMenuPoint(pointer: { x: number; y: number } | null, rect: { left: number; top: number; bottom: number }, viewportHeight: number): ContextMenuPoint {
  if (pointer) return { x: pointer.x, y: pointer.y, above: pointer.y > viewportHeight / 2 };
  const above = rect.top > viewportHeight / 2;
  return { x: rect.left, y: above ? rect.top - 4 : rect.bottom + 4, above };
}
