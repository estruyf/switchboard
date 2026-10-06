/**
 * Find-in-session highlights, drawn with the CSS Custom Highlight API (`::highlight(find)` in
 * styles.css) so the transcript's DOM, which React owns, is never changed.
 */

/** Labels, buttons and other chrome inside a row that find doesn't search. */
const SKIP = '[data-find-skip], button, .sr-only, .select-none, [aria-hidden="true"]';

/** Ranges for each case-insensitive occurrence of `needle` (lower-cased) in the text under `root`. */
export function rangesIn(root: Element, needle: string): Range[] {
  if (!needle) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.toLowerCase() ?? '';
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
    }
  }
  return ranges;
}

// Two panes can each have find open; the registry is global, so it shows the union.
const owners = new Map<string, { all: Range[]; current: Range | null }>();

function redraw(): void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
  const all = [...owners.values()].flatMap((o) => o.all);
  const current = [...owners.values()].flatMap((o) => (o.current ? [o.current] : []));
  CSS.highlights.set('find', new Highlight(...all));
  CSS.highlights.set('find-current', new Highlight(...current));
}

export function setFindHighlights(owner: string, all: Range[], current: Range | null): void {
  owners.set(owner, { all, current });
  redraw();
}

export function clearFindHighlights(owner: string): void {
  if (owners.delete(owner)) redraw();
}
