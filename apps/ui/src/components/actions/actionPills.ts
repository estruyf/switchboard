/** How many project actions get a pill above the message box; the rest are behind "N more". */
export const MAX_ACTION_PILLS = 3;

/**
 * Splits the project's actions into the ones shown as pills and the ones behind the "N more" pill.
 * Up to `max` actions all get a pill; with more, the first `max` do and the rest go in the menu.
 */
export function splitActionPills<T>(actions: readonly T[], max: number = MAX_ACTION_PILLS): { pills: T[]; more: T[] } {
  if (actions.length <= max) return { pills: [...actions], more: [] };
  return { pills: actions.slice(0, max), more: actions.slice(max) };
}
