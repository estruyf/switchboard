interface Rect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}
interface Size {
  width: number;
  height: number;
}

const GAP = 6;
const MARGIN = 8;

/**
 * Where a tooltip goes: centred below its target, or above when there's no room below, and always
 * kept inside the window with a small margin.
 */
export function placeTooltip(target: Rect, tip: Size, viewport: Size): { left: number; top: number } {
  const centred = target.left + target.width / 2 - tip.width / 2;
  const left = Math.max(MARGIN, Math.min(centred, viewport.width - tip.width - MARGIN));
  const below = target.bottom + GAP;
  const top = below + tip.height + MARGIN <= viewport.height ? below : Math.max(MARGIN, target.top - GAP - tip.height);
  return { left: Math.round(left), top: Math.round(top) };
}
