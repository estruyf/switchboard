/**
 * Several sessions picked in the sidebar at once, Finder style: ⌘-click toggles a row, ⇧-click (or ⇧↑/↓)
 * takes the range from the anchor. Separate from the open session, which a plain click still sets.
 */
export interface Picks {
  ids: ReadonlySet<string>;
  /** Where a ⇧-range starts. */
  anchor: string | null;
  /** Where the last ⇧-range ended; ⇧↑/↓ move on from here. */
  end: string | null;
}

export const NO_PICKS: Picks = { ids: new Set(), anchor: null, end: null };

/** ⌘-click: adds or removes one row. Starting a selection takes the open session along, as Finder does. */
export function togglePick(picks: Picks, id: string, current: string | null, order: readonly string[]): Picks {
  const ids = new Set(picks.ids);
  if (ids.size === 0 && current && current !== id && order.includes(current)) ids.add(current);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchor: id, end: id };
}

/** ⇧-click: every row from the anchor (or the open session) to this one, in list order. */
export function rangePick(picks: Picks, id: string, current: string | null, order: readonly string[]): Picks {
  const to = order.indexOf(id);
  if (to === -1) return picks;
  const anchor = picks.anchor && order.includes(picks.anchor) ? picks.anchor : current;
  const from = anchor ? order.indexOf(anchor) : -1;
  if (from === -1) return { ids: new Set([id]), anchor: id, end: id };
  return { ids: new Set(order.slice(Math.min(from, to), Math.max(from, to) + 1)), anchor, end: id };
}

/** ⇧↑/↓: grows or shrinks the range by one row. Null when there's nowhere to go. */
export function stepPick(picks: Picks, direction: 1 | -1, current: string | null, order: readonly string[]): Picks | null {
  const from = picks.end ?? current;
  const index = from ? order.indexOf(from) : -1;
  const next = order[index === -1 ? 0 : index + direction];
  if (!next) return null;
  return rangePick(picks.ids.size > 0 ? picks : { ...picks, anchor: current }, next, current, order);
}

/** The picked ids the list still shows (archiving, deleting or a filter can take rows away). */
export const visiblePicks = (picks: Picks, order: readonly string[]): string[] => order.filter((id) => picks.ids.has(id));
