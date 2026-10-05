import type { AppStateStore, JsonValue } from '../db/appState.ts';

/** In-memory AppStateStore for tests. */
export function appStateFake(initial: Record<string, JsonValue> = {}): AppStateStore & { dump(): Record<string, JsonValue> } {
  const data = new Map(Object.entries(initial));
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
    dump: () => Object.fromEntries(data),
  };
}
