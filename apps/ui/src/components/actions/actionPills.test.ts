import { describe, expect, it } from 'vitest';
import { actionContextItems, MAX_ACTION_PILLS, splitActionPills } from './actionPills.ts';

describe('splitActionPills', () => {
  it('shows no pills without actions', () => {
    expect(splitActionPills([])).toEqual({ pills: [], more: [] });
  });

  it('shows every action as a pill up to the limit', () => {
    expect(splitActionPills(['a', 'b', 'c'])).toEqual({ pills: ['a', 'b', 'c'], more: [] });
  });

  it('puts the actions past the limit behind "more"', () => {
    expect(splitActionPills(['a', 'b', 'c', 'd', 'e'])).toEqual({ pills: ['a', 'b', 'c'], more: ['d', 'e'] });
  });

  it('defaults to three pills', () => {
    expect(MAX_ACTION_PILLS).toBe(3);
    expect(splitActionPills(['a', 'b'], 1)).toEqual({ pills: ['a'], more: ['b'] });
  });
});

describe('actionContextItems', () => {
  it('offers Run, Edit… and Delete… for your own actions', () => {
    expect(actionContextItems({ scope: 'project' })).toEqual([
      { command: 'run', label: 'Run' },
      { command: 'edit', label: 'Edit…' },
      { command: 'delete', label: 'Delete…', danger: true },
    ]);
    expect(actionContextItems({ scope: 'global' }).every((item) => !item.disabledReason)).toBe(true);
  });

  it("can't delete a shared action, which lives in .switchboard.json", () => {
    const items = actionContextItems({ scope: 'shared' });
    expect(items.map((i) => i.command)).toEqual(['run', 'edit', 'delete']);
    expect(items.find((i) => i.command === 'delete')?.disabledReason).toMatch(/switchboard\.json/);
    expect(items.filter((i) => i.disabledReason)).toHaveLength(1);
  });
});
