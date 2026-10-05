import { describe, expect, it } from 'vitest';
import { placeTooltip } from './tooltipPlacement.ts';

const viewport = { width: 1000, height: 800 };

describe('placeTooltip', () => {
  it('centres the tooltip below its target', () => {
    expect(placeTooltip({ left: 100, top: 100, bottom: 120, width: 20 }, { width: 60, height: 20 }, viewport)).toEqual({ left: 80, top: 126 });
  });

  it('flips above when there is no room below', () => {
    expect(placeTooltip({ left: 100, top: 770, bottom: 790, width: 20 }, { width: 60, height: 20 }, viewport)).toEqual({ left: 80, top: 744 });
  });

  it('stays inside the window horizontally', () => {
    expect(placeTooltip({ left: 0, top: 100, bottom: 120, width: 10 }, { width: 200, height: 20 }, viewport).left).toBe(8);
    expect(placeTooltip({ left: 990, top: 100, bottom: 120, width: 10 }, { width: 200, height: 20 }, viewport).left).toBe(792);
  });
});
