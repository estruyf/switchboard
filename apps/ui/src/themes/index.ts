import demoTime from './demo-time.json';
import solarized from './solarized.json';

/**
 * The themes that ship with Switchboard, in picker order. They are theme files like any other and go
 * through the same validation as imports (main checks them at start, and the unit tests too), so the
 * format is used every day and can't drift.
 */
export const BUILT_IN_THEMES: ReadonlyArray<{ id: string; raw: unknown }> = [
  { id: 'demo-time', raw: demoTime },
  { id: 'solarized', raw: solarized },
];
