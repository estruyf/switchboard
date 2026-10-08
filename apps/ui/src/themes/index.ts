import demoTime from './demo-time.json';
import githubHighContrast from './github-high-contrast.json';
import github from './github.json';
import vscodeHighContrast from './vscode-high-contrast.json';
import vscode from './vscode.json';

/**
 * The themes that ship with Switchboard, in picker order. They are theme files like any other and go
 * through the same validation as imports (main checks them at start, and the unit tests too), so the
 * format is used every day and can't drift. `highContrast` ones are held to WCAG AAA.
 */
export const BUILT_IN_THEMES: ReadonlyArray<{ id: string; raw: unknown; highContrast: boolean }> = [
  { id: 'demo-time', raw: demoTime, highContrast: false },
  { id: 'github', raw: github, highContrast: false },
  { id: 'github-high-contrast', raw: githubHighContrast, highContrast: true },
  { id: 'vscode', raw: vscode, highContrast: false },
  { id: 'vscode-high-contrast', raw: vscodeHighContrast, highContrast: true },
];
