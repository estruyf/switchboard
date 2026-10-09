import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { placeWindow, sanitizeWindowState, WindowStateStore } from './windowState.ts';

const MIN = { width: 900, height: 560 };
const LAPTOP = { x: 0, y: 25, width: 1512, height: 920 };
// An external display to the right of the laptop.
const EXTERNAL = { x: 1512, y: -400, width: 2560, height: 1415 };

describe('placeWindow', () => {
  it('keeps a window that fits where it was, on whichever display that is', () => {
    const onExternal = { x: 1800, y: -300, width: 1600, height: 1000 };
    expect(placeWindow(onExternal, [LAPTOP, EXTERNAL], MIN)).toEqual(onExternal);
    const onLaptop = { x: 100, y: 60, width: 1200, height: 800 };
    expect(placeWindow(onLaptop, [LAPTOP, EXTERNAL], MIN)).toEqual(onLaptop);
  });

  it('opens at the default place when its display is gone', () => {
    expect(placeWindow({ x: 1800, y: -300, width: 1600, height: 1000 }, [LAPTOP], MIN)).toBeUndefined();
  });

  it('moves a window that hangs off the edge onto the display it mostly covers, and shrinks it to fit', () => {
    expect(placeWindow({ x: 1300, y: 100, width: 1200, height: 800 }, [LAPTOP], MIN)).toEqual({ x: 312, y: 100, width: 1200, height: 800 });
    expect(placeWindow({ x: 1000, y: -350, width: 2400, height: 1200 }, [LAPTOP, EXTERNAL], MIN)).toEqual({ x: 1512, y: -350, width: 2400, height: 1200 });
    expect(placeWindow({ x: -50, y: 0, width: 3000, height: 2000 }, [LAPTOP], MIN)).toEqual(LAPTOP);
  });

  it('never restores below the minimum size', () => {
    expect(placeWindow({ x: 10, y: 40, width: 200, height: 100 }, [LAPTOP], MIN)).toEqual({ x: 10, y: 40, width: 900, height: 560 });
  });
});

describe('sanitizeWindowState', () => {
  it('accepts saved bounds and rejects anything else', () => {
    expect(sanitizeWindowState({ bounds: { x: 1.4, y: 2, width: 1000, height: 700 }, maximized: true })).toEqual({ bounds: { x: 1, y: 2, width: 1000, height: 700 }, maximized: true });
    expect(sanitizeWindowState({ bounds: { x: 0, y: 0, width: 1000, height: 700 } })).toEqual({ bounds: { x: 0, y: 0, width: 1000, height: 700 }, maximized: false });
    expect(sanitizeWindowState(undefined)).toBeUndefined();
    expect(sanitizeWindowState({ bounds: { x: 0, y: 0, width: 0, height: 700 } })).toBeUndefined();
    expect(sanitizeWindowState({ bounds: { x: 'a', y: 0, width: 10, height: 10 } })).toBeUndefined();
  });
});

describe('WindowStateStore', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const file = () => {
    const dir = mkdtempSync(join(tmpdir(), 'switchboard-window-'));
    dirs.push(dir);
    return join(dir, 'window-state.json');
  };

  it('saves the state and reads it back on the next launch', () => {
    const path = file();
    expect(new WindowStateStore(path).get()).toBeUndefined();
    new WindowStateStore(path).save({ bounds: { x: 1800, y: -300, width: 1600, height: 1000 }, maximized: false });
    expect(new WindowStateStore(path).get()).toEqual({ bounds: { x: 1800, y: -300, width: 1600, height: 1000 }, maximized: false });
    expect(JSON.parse(readFileSync(path, 'utf8')).bounds.width).toBe(1600);
  });

  it('ignores a damaged file', () => {
    const path = file();
    writeFileSync(path, '{"bounds":');
    expect(new WindowStateStore(path).get()).toBeUndefined();
  });
});
