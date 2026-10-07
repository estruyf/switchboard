import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { LaterDraft, type LaterItem } from '@switchboard/protocol';

/** The choices stored next to a prompt, as JSON (everything in a draft except the folder and the prompt). */
type Settings = Omit<LaterItem, 'id' | 'cwd' | 'prompt' | 'createdAt'>;

interface Row {
  id: string;
  cwd: string;
  prompt: string;
  settings_json: string;
  created_at: number;
}

/**
 * Prompts parked on the Later list instead of starting a session. Kept in `later_prompts`, a user
 * choice, so the list survives a cache rebuild. Deliberately small: add, list, remove.
 */
export class LaterStore {
  private readonly statements;

  constructor(db: DatabaseSync) {
    this.statements = {
      // Newest first; the id breaks ties between two saved in the same millisecond.
      all: db.prepare('SELECT * FROM later_prompts ORDER BY created_at DESC, id DESC'),
      inFolder: db.prepare('SELECT * FROM later_prompts WHERE cwd = ? ORDER BY created_at DESC, id DESC'),
      upsert: db.prepare(`
        INSERT INTO later_prompts (id, cwd, prompt, settings_json, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET cwd = excluded.cwd, prompt = excluded.prompt, settings_json = excluded.settings_json, created_at = excluded.created_at`),
      remove: db.prepare('DELETE FROM later_prompts WHERE id = ?'),
    };
  }

  /** Every saved prompt, or one folder's, newest first. */
  list(cwd?: string): LaterItem[] {
    const rows = (cwd ? this.statements.inFolder.all(cwd) : this.statements.all.all()) as unknown as Row[];
    return rows.flatMap((row) => {
      // A row a newer build wrote differently is skipped rather than failing the whole list.
      const parsed = LaterDraft.safeParse({ ...safeJson(row.settings_json), cwd: row.cwd, prompt: row.prompt });
      return parsed.success ? [{ ...parsed.data, id: row.id, createdAt: row.created_at }] : [];
    });
  }

  /** Saves a prompt. Passing the `id` and `createdAt` of a removed item puts it back in its place (Undo). */
  add(draft: LaterDraft, restore: { id?: string; createdAt?: number } = {}): LaterItem {
    const { cwd, prompt, ...settings } = LaterDraft.parse(draft);
    const item: LaterItem = { cwd, prompt, ...settings, id: restore.id ?? randomUUID(), createdAt: restore.createdAt ?? Date.now() };
    this.statements.upsert.run(item.id, cwd, prompt, JSON.stringify(settings satisfies Settings), item.createdAt);
    return item;
  }

  remove(id: string): void {
    this.statements.remove.run(id);
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
