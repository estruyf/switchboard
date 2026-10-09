import { readJsonFile, writeFileAtomic } from './jsonFile.ts';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the window was when it last moved or closed: its normal (not maximized) bounds and whether it was maximized. */
export interface WindowState {
  bounds: Rect;
  maximized: boolean;
}

const isRect = (value: unknown): value is Rect => {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return [r.x, r.y, r.width, r.height].every((n) => typeof n === 'number' && Number.isFinite(n)) && (r.width as number) > 0 && (r.height as number) > 0;
};

/** The saved state, or undefined when the file is missing or damaged. */
export function sanitizeWindowState(value: unknown): WindowState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (!isRect(v.bounds)) return undefined;
  const { x, y, width, height } = v.bounds;
  return { bounds: { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }, maximized: v.maximized === true };
}

const overlap = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/**
 * Where to open a window saved at `bounds`, given the work areas of the connected displays: on the display it
 * overlaps most, shrunk to fit and moved fully onto it. Undefined when it overlaps none (its display was
 * unplugged), so the window opens at its default size on the main display instead of off screen.
 */
export function placeWindow(bounds: Rect, workAreas: Rect[], min: { width: number; height: number }): Rect | undefined {
  let best: Rect | undefined;
  let bestOverlap = 0;
  for (const area of workAreas) {
    const o = overlap(bounds, area);
    if (o > bestOverlap) [best, bestOverlap] = [area, o];
  }
  if (!best) return undefined;
  const width = Math.min(Math.max(bounds.width, min.width), best.width);
  const height = Math.min(Math.max(bounds.height, min.height), best.height);
  const x = Math.min(Math.max(bounds.x, best.x), best.x + best.width - width);
  const y = Math.min(Math.max(bounds.y, best.y), best.y + best.height - height);
  return { x, y, width, height };
}

/** The main window's last size and position, saved as JSON in the app's data folder. */
export class WindowStateStore {
  #state: WindowState | undefined;

  constructor(private readonly file: string) {
    this.#state = sanitizeWindowState(readJsonFile(file));
  }

  get(): WindowState | undefined {
    return this.#state;
  }

  save(state: WindowState): void {
    const clean = sanitizeWindowState(state);
    if (!clean) return;
    this.#state = clean;
    try {
      writeFileAtomic(this.file, `${JSON.stringify(clean, null, 2)}\n`);
    } catch {
      // Still used for windows opened in this run.
    }
  }
}
