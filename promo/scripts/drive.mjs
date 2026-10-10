// How the capture moves around the app: a pointer that glides, clicks that read
// as clicks, typing at a person's pace, and the setup every shot starts from.

import { settle } from './harness.mjs';

export const pause = (page, ms) => page.waitForTimeout(ms);

const locate = (page, target) => (typeof target === 'string' ? page.locator(target).locator('visible=true').first() : target);

/** Glide the pointer to the middle of `target`. Playwright's default is a teleport, which in a recording reads as a cut. */
export async function moveTo(page, target, { steps = 24, dx = 0, dy = 0 } = {}) {
  const box = await locate(page, target).boundingBox();
  if (!box) throw new Error(`moveTo: ${target} has no box`);
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps });
  return box;
}

/** Move, settle for a beat so the hover state reads, then click. */
export async function clickOn(page, target, { before = 260, after = 450, ...move } = {}) {
  await moveTo(page, target, move);
  await pause(page, before);
  await page.mouse.down();
  await pause(page, 80);
  await page.mouse.up();
  await pause(page, after);
}

/** Type at something near a person's rate: fields that filter as you type are invisible at Playwright's default. */
export async function typeText(page, text, { delay = 45 } = {}) {
  await page.keyboard.type(text, { delay });
}

/** Send the pointer somewhere nothing reacts to it: the window's top-left corner, where the traffic lights go. (The
 *  top of the main view isn't safe: in a session, that is the title, and its tooltip ends up in the shot.) */
export async function park(page) {
  await page.mouse.move(6, 6, { steps: 4 });
  await pause(page, 200);
}

/** Waits for a selector to be on screen. */
export const need = (page, selector, timeout = 10_000) => page.locator(selector).locator('visible=true').first().waitFor({ state: 'visible', timeout });

/** Waits for an expression in the page to be truthy. */
export const until = (page, expression, timeout = 10_000, arg = null) => page.waitForFunction(expression, arg, { timeout });

/** The id of the session whose sidebar row says `title`. */
export async function sessionId(page, title) {
  const id = await page.evaluate((t) => [...document.querySelectorAll('[data-session-id]')].find((el) => el.innerText.includes(t))?.dataset.sessionId ?? null, title);
  if (!id) throw new Error(`no session "${title}" in the sidebar`);
  return id;
}

/** Opens a session from the sidebar, without the pointer (setup, not a shot). */
export async function openSession(page, title) {
  const id = await sessionId(page, title);
  await page.locator(`[data-session-id="${id}"]`).first().click();
  await need(page, `[data-current-session="${id}"] [data-transcript-item]`);
  return id;
}

/** Back to Home with nothing open over it, so one shot's leftovers can't end up in the next. */
export async function reset(page) {
  for (let i = 0; i < 3; i++) {
    if (!(await page.evaluate(() => !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [data-search], [data-command-palette]')))) break;
    await page.keyboard.press('Escape');
    await pause(page, 150);
  }
  if (await page.evaluate(() => !!document.querySelector('[data-close-settings]'))) await page.locator('[data-close-settings]').first().click();
  await page.locator('[data-go-home]').first().click();
  await need(page, '[data-home]');
  await park(page);
  await settle(page, 300);
}

/** Opens the Projects view (its sidebar button toggles, so only when it isn't open). */
export async function openProjects(page) {
  if (!(await page.evaluate(() => !!document.querySelector('[data-project-manager]')))) await page.locator('[data-open-projects]').first().click();
  await need(page, '[data-project-manager]');
}

/** Adds the demo folders as projects, as someone would on first launch. */
export async function addProjects(page) {
  await openProjects(page);
  await page.locator('[data-manager-add]').first().click();
  await need(page, '[data-add-project-dialog] [data-known-project]');
  for (let i = 0; i < 8; i++) {
    const added = await page.evaluate(() => {
      const el = document.querySelector('[data-known-project][data-added="false"]');
      el?.click();
      return !!el;
    });
    if (!added) break;
    await pause(page, 250);
  }
  await page.keyboard.press('Escape');
  await until(page, () => !document.querySelector('[data-add-project-dialog]'));
}

/** Opens Settings on a section. */
export async function openSettings(page, section) {
  await page.locator('[data-open-settings]').first().click();
  await need(page, `[data-settings-section="${section}"]`);
  await page.locator(`[data-settings-section="${section}"]`).first().click();
  await settle(page, 200);
}

/** The Work profile's sessions are in the sidebar, with their profile badge. */
export const workSessionsListed = (page) =>
  until(page, () => [...document.querySelectorAll('[data-session-id]')].some((el) => el.innerText.includes('Fix rounding') && el.querySelector('[data-profile-badge]')), 20_000);
