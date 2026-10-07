/**
 * Find-in-session highlights, drawn with the CSS Custom Highlight API (`::highlight(find)` in
 * styles.css) so the transcript's DOM, which React owns, is never changed.
 */

/** Labels, buttons and other chrome inside a row that find doesn't search. */
const SKIP = '[data-find-skip], button, .sr-only, .select-none, [aria-hidden="true"]';

/**
 * Where each case-insensitive occurrence of `needle` (lower-cased) sits in `text`, as [start, end)
 * offsets into the original text. A few characters change length when lower-cased ('İ' becomes two
 * code units), so offsets found in the lower-cased text are mapped back rather than used as they are.
 */
export function matchOffsets(text: string, needle: string): Array<[number, number]> {
  if (!needle) return [];
  const out: Array<[number, number]> = [];
  const lower = text.toLowerCase();
  if (lower.length === text.length) {
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + needle.length)) out.push([at, at + needle.length]);
    return out;
  }
  // For each code unit of the lower-cased text: where the character it came from starts and ends.
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < text.length; ) {
    const char = String.fromCodePoint(text.codePointAt(i)!);
    const low = char.toLowerCase();
    for (let k = 0; k < low.length; k++) {
      starts.push(i);
      ends.push(i + char.length);
    }
    folded += low;
    i += char.length;
  }
  for (let at = folded.indexOf(needle); at !== -1; at = folded.indexOf(needle, at + needle.length)) {
    out.push([starts[at]!, ends[at + needle.length - 1]!]);
  }
  return out;
}

/** Ranges for each case-insensitive occurrence of `needle` (lower-cased) in the text under `root`. */
export function rangesIn(root: Element, needle: string): Range[] {
  if (!needle) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const [start, end] of matchOffsets(node.textContent ?? '', needle)) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
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
