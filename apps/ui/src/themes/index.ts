import catppuccin from './catppuccin.json';
import claude from './claude.json';
import demoTime from './demo-time.json';
import nord from './nord.json';
import solarized from './solarized.json';
import theUnnamed from './the-unnamed.json';

/**
 * The themes that ship with Switchboard, in picker order. They are theme files like any other and go
 * through the same validation as imports (main checks them at start, and the unit tests too), so the
 * format is used every day and can't drift.
 */
export const BUILT_IN_THEMES: ReadonlyArray<{ id: string; raw: unknown }> = [
  { id: 'demo-time', raw: demoTime },
  { id: 'catppuccin', raw: catppuccin },
  { id: 'claude', raw: claude },
  { id: 'nord', raw: nord },
  { id: 'solarized', raw: solarized },
  { id: 'the-unnamed', raw: theUnnamed },
];
