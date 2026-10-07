import type { BrowserWindow } from 'electron';

// Drives the renderer like a user would, for the smoke test and the README screenshots.

/** Polls a condition in the renderer. */
export async function waitInPage(win: BrowserWindow, expression: string, timeoutMs = 10_000): Promise<boolean> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** Sets a React-controlled field the way a user would, so onChange fires. */
export function setFieldValue(win: BrowserWindow, selector: string, value: string): Promise<unknown> {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  })()`);
}
