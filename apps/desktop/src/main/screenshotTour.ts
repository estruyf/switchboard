import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { setFieldValue, waitInPage } from './pageDriver.ts';

/**
 * The README screenshots (npm run screenshots): a walk through the app in the made-up home folder
 * that scripts/screenshot-demo.ts builds, once in dark and once in light mode. Each view is saved as
 * `<name>-<scheme>.png`; scripts/screenshot-frame.mjs puts them in a window frame afterwards.
 * Nothing is sent to Claude and nothing is changed in the demo projects.
 */
export interface TourHooks {
  setColorScheme(scheme: 'light' | 'dark'): void;
}

/** The window size the screenshots are taken at (points; the PNGs are at the display's scale). */
export const TOUR_SIZE = { width: 1440, height: 900 } as const;

export async function runScreenshotTour(win: BrowserWindow, outDir: string, hooks: TourHooks): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const js = <T = unknown>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const key = (keyCode: string, modifiers: Array<'meta' | 'shift' | 'alt'> = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };
  const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));
  const need = async (expression: string, what: string, timeoutMs = 8_000) => {
    if (await waitInPage(win, expression, timeoutMs)) return;
    writeFileSync(join(outDir, 'failed.png'), (await win.webContents.capturePage()).toPNG());
    throw new Error(`${what} (waited for ${expression}; see failed.png)`);
  };
  const row = (sessionId: string) => `[data-session-id="${sessionId}"]`;
  const openSession = async (title: string) => {
    const id = await js<string | null>(
      `[...document.querySelectorAll('[data-session-id]')].find((el) => el.innerText.includes(${JSON.stringify(title)}))?.dataset.sessionId ?? null`,
    );
    if (!id) throw new Error(`no session "${title}" in the sidebar`);
    await click(row(id));
    await need(`document.querySelector('[data-current-session="${id}"] [data-transcript-item]')`, `"${title}" did not open`);
    return id;
  };
  /** `keepFocus` for overlays that close when their field loses focus. */
  const shot = async (name: string, keepFocus = false) => {
    // Let animations, fonts and the virtualised list settle; hide the text cursor and any tooltip.
    if (!keepFocus) await js('document.activeElement?.blur?.()');
    await settle(600);
    writeFileSync(join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };

  win.setContentSize(TOUR_SIZE.width, TOUR_SIZE.height);
  win.center();
  await need("document.querySelector('[data-session-id]')", 'the sidebar listed no sessions', 15_000);

  // Add the demo projects, as someone would on first launch.
  await click('[data-open-projects]');
  await click('[data-manager-add]');
  await need("document.querySelector('[data-add-project-dialog] [data-known-project]')", 'no folders offered to add');
  for (let i = 0; i < 8; i++) {
    const added = await js<boolean>("(() => { const el = document.querySelector('[data-known-project][data-added=\"false\"]'); el?.click(); return !!el; })()");
    if (!added) break;
    await settle(250);
  }
  key('Escape');
  await need("!document.querySelector('[data-add-project-dialog]')", 'the add project dialog did not close');

  const hero = 'Add dark mode toggle';
  for (const scheme of ['dark', 'light'] as const) {
    hooks.setColorScheme(scheme);
    await settle(500);

    // Home: what needs you, what is working, and the projects.
    await click('[data-go-home]');
    await need("document.querySelector('[data-home]')", 'Home did not open');
    // The demo home has no Claude login, so its usage card could only say it has no numbers.
    await js("document.querySelector('[data-home-profiles]')?.style.setProperty('display', 'none')");
    await shot(`home-${scheme}`);

    // A finished session with its Changes panel and the first diff open.
    await openSession(hero);
    await need("document.querySelector('[data-toggle-changes]')", 'no Changes button');
    if (!(await js<boolean>("!!document.querySelector('[data-changes-panel]')"))) await click('[data-toggle-changes]');
    await need("document.querySelector('[data-changed-file]')", 'the Changes panel listed no files');
    // A changed file shows both sides of the diff; the new file would be all green.
    if (!(await js<boolean>("!!document.querySelector('[data-changed-file=\"src/lib/theme.ts\"] [data-file-diff] div')"))) {
      await js("document.querySelectorAll('[data-file-diff]').forEach((diff) => diff.closest('[data-changed-file]').querySelector('[data-file-toggle]').click())");
      await click('[data-changed-file="src/lib/theme.ts"] [data-file-toggle]');
    }
    await need("document.querySelector('[data-file-diff] div')", 'the diff did not open');
    await shot(`session-${scheme}`);
    await click('[data-toggle-changes]');
    await need("!document.querySelector('[data-changes-panel]')", 'the Changes panel did not close');

    // Two sessions side by side: the finished one and one working in a terminal.
    const working = await js<string | null>(
      "[...document.querySelectorAll('[data-session-id]')].find((el) => el.innerText.includes('Fix rounding'))?.dataset.sessionId ?? null",
    );
    if (!working) throw new Error('no working session in the sidebar');
    await js(`document.querySelector('${row(working)}').dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))`);
    await need(`document.querySelectorAll('[data-pane]').length === 2 && document.querySelector('[data-current-session="${working}"] [data-transcript-item]')`, 'the second pane did not open');
    await shot(`split-${scheme}`);
    await click('[data-pane="split"] [data-close-pane]');
    await need("!document.querySelector('[data-split]')", 'the second pane did not close');

    // Search across every conversation.
    key('F', ['meta', 'shift']);
    await need("document.querySelector('[data-search] input')", '⌘⇧F did not open search');
    await setFieldValue(win, '[data-search] input', 'theme');
    await need("document.querySelector('[data-search-hit]')", 'search found nothing', 30_000);
    await shot(`search-${scheme}`, true);
    key('Escape');
    await need("!document.querySelector('[data-search]')", 'search did not close');

    // New session in a project, with a prompt typed but not sent.
    key('N', ['meta']);
    await need("document.querySelector('[data-new-session-view]') && document.querySelector('[data-folder-select]')?.dataset.value", 'New session did not open with a project');
    // ⌘2: acme-store, the project the prompt is about.
    key('2', ['meta']);
    await need("document.querySelector('[data-folder-select]')?.dataset.value.endsWith('/acme-store')", '⌘2 did not pick acme-store');
    await setFieldValue(win, '[data-new-session-view] [data-composer]', 'Add a keyboard shortcut (⌘⇧L) that switches between light and dark mode, and show it next to the toggle in Settings.');
    await shot(`new-session-${scheme}`);
    await setFieldValue(win, '[data-new-session-view] [data-composer]', '');
  }
}
