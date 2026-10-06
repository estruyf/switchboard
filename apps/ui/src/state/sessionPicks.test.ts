import { describe, expect, it } from 'vitest';
import { NO_PICKS, pickGroup, rangePick, stepPick, togglePick, visiblePicks } from './sessionPicks.ts';

const ORDER = ['a', 'b', 'c', 'd', 'e'];
const ids = (picks: { ids: ReadonlySet<string> }) => [...picks.ids].sort();

describe('session picks', () => {
  it('⌘-click takes the open session along and toggles rows', () => {
    const one = togglePick(NO_PICKS, 'c', 'a', ORDER);
    expect(ids(one)).toEqual(['a', 'c']);
    expect(ids(togglePick(one, 'c', 'a', ORDER))).toEqual(['a']);
    // The open session isn't added when it isn't in the list (or is the row clicked).
    expect(ids(togglePick(NO_PICKS, 'c', 'gone', ORDER))).toEqual(['c']);
    expect(ids(togglePick(NO_PICKS, 'c', 'c', ORDER))).toEqual(['c']);
  });

  it('⇧-click selects the range from the anchor, or from the open session', () => {
    expect(ids(rangePick(NO_PICKS, 'd', 'b', ORDER))).toEqual(['b', 'c', 'd']);
    const anchored = togglePick(NO_PICKS, 'e', null, ORDER);
    expect(ids(rangePick(anchored, 'c', 'a', ORDER))).toEqual(['c', 'd', 'e']);
    expect(ids(rangePick(NO_PICKS, 'b', null, ORDER))).toEqual(['b']);
    expect(rangePick(anchored, 'zz', null, ORDER)).toBe(anchored);
  });

  it('⇧↑/↓ grow and shrink the range from the open session', () => {
    const down = stepPick(NO_PICKS, 1, 'b', ORDER)!;
    expect(ids(down)).toEqual(['b', 'c']);
    const further = stepPick(down, 1, 'b', ORDER)!;
    expect(ids(further)).toEqual(['b', 'c', 'd']);
    expect(ids(stepPick(further, -1, 'b', ORDER)!)).toEqual(['b', 'c']);
    expect(stepPick(NO_PICKS, -1, 'a', ORDER)).toBeNull();
  });

  it('picks a whole group, or takes it away', () => {
    const one = togglePick(NO_PICKS, 'a', null, ORDER);
    const group = pickGroup(one, ['c', 'd', 'e']);
    expect(ids(group)).toEqual(['a', 'c', 'd', 'e']);
    // ⇧↑/↓ carry on from the group's last row.
    expect(group.anchor).toBe('c');
    expect(group.end).toBe('e');
    expect(ids(pickGroup(group, ['c', 'd', 'e'], false))).toEqual(['a']);
  });

  it('keeps only the picks the list still shows, in list order', () => {
    expect(visiblePicks({ ids: new Set(['d', 'gone', 'a']), anchor: null, end: null }, ORDER)).toEqual(['a', 'd']);
  });
});
