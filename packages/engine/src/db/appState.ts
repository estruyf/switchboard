import type { DatabaseSync } from 'node:sqlite';

/** JSON values persisted under a string key (UI prefs, default editor, last open session…). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface AppStateStore {
  get(key: string): JsonValue | null;
  set(key: string, value: JsonValue): void;
}

export function createAppStateStore(db: DatabaseSync): AppStateStore {
  const select = db.prepare('SELECT value FROM app_state WHERE key = ?');
  const upsert = db.prepare(
    'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  return {
    get(key) {
      const row = select.get(key) as { value: string } | undefined;
      return row ? (JSON.parse(row.value) as JsonValue) : null;
    },
    set(key, value) {
      upsert.run(key, JSON.stringify(value));
    },
  };
}
