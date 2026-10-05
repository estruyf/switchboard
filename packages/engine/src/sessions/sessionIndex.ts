import { existsSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { LogLevel, SessionsChanged, SessionSummary } from '@switchboard/protocol';
import { originFromEntrypoint, readEntrypoint } from '../claude/origin.ts';
import type { ProjectResolver } from '../claude/projectResolver.ts';
import type { RawSessionInfo, SessionSource } from '../claude/sessionSource.ts';
import { coalesce } from '../util/coalesce.ts';

interface Entry {
  summary: SessionSummary;
  path: string | null;
  mtime: number | null;
  entrypoint: string | null;
}

interface TranscriptFile {
  path: string;
  mtime: number;
}

export interface SessionIndexOptions {
  db: DatabaseSync;
  source: SessionSource;
  /** `~/.claude/projects` */
  projectsDir: string;
  resolver: ProjectResolver;
  onChange: (change: SessionsChanged) => void;
  /** A transcript file was written (its summary may or may not have changed). */
  onTranscriptChanged: (sessionId: string) => void;
  log: (level: LogLevel, message: string) => void;
  /** Safety-net full rescan, in case file events were missed. */
  refreshIntervalMs?: number;
}

const SESSION_FILE = /^([^\\/]+)[\\/]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const TITLE_MAX = 300;

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * The sidebar's source of truth inside the engine. Starts from the SQLite cache
 * (instant), reconciles with ~/.claude through the SDK, then follows file
 * changes. Every change is persisted and emitted as a `sessions.changed` delta.
 */
export class SessionIndex {
  private readonly entries = new Map<string, Entry>();
  private complete = false;
  private refreshing: Promise<void> | undefined;
  private watcher: FSWatcher | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly perFile = new Map<string, ReturnType<typeof coalesce>>();
  private readonly statements;

  constructor(private readonly options: SessionIndexOptions) {
    const { db } = options;
    this.statements = {
      all: db.prepare('SELECT id, jsonl_path, jsonl_mtime, entrypoint, summary_json FROM sessions'),
      upsert: db.prepare(`
        INSERT INTO sessions (id, project_root, updated_at, jsonl_path, jsonl_mtime, entrypoint, summary_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          project_root = excluded.project_root, updated_at = excluded.updated_at,
          jsonl_path = excluded.jsonl_path, jsonl_mtime = excluded.jsonl_mtime,
          entrypoint = excluded.entrypoint, summary_json = excluded.summary_json`),
      remove: db.prepare('DELETE FROM sessions WHERE id = ?'),
    };
    this.loadCache();
  }

  private loadCache(): void {
    for (const row of this.statements.all.all() as Array<Record<string, unknown>>) {
      try {
        this.entries.set(String(row.id), {
          summary: JSON.parse(String(row.summary_json)) as SessionSummary,
          path: (row.jsonl_path as string | null) ?? null,
          mtime: (row.jsonl_mtime as number | null) ?? null,
          entrypoint: (row.entrypoint as string | null) ?? null,
        });
      } catch {
        // A bad row only costs us a cache miss; the refresh rebuilds it.
      }
    }
  }

  /** Sessions newest first, plus whether the first full scan has finished. */
  snapshot(): { sessions: SessionSummary[]; complete: boolean } {
    const sessions = [...this.entries.values()].map((e) => e.summary).sort((a, b) => b.updatedAt - a.updatedAt);
    return { sessions, complete: this.complete };
  }

  start(): void {
    void this.refresh();
    try {
      this.watcher = watch(this.options.projectsDir, { recursive: true }, (_event, filename) => {
        const match = filename ? SESSION_FILE.exec(filename.toString()) : null;
        if (match) this.fileChanged(match[2]!, join(this.options.projectsDir, filename!.toString()));
      });
      this.watcher.on('error', (error) => this.options.log('warn', `Watching ${this.options.projectsDir} failed: ${error.message}`));
    } catch (error) {
      this.options.log('warn', `Cannot watch ${this.options.projectsDir}: ${(error as Error).message}`);
    }
    this.timer = setInterval(() => void this.refresh(), this.options.refreshIntervalMs ?? 120_000);
    this.timer.unref?.();
  }

  stop(): void {
    this.watcher?.close();
    if (this.timer) clearInterval(this.timer);
    for (const c of this.perFile.values()) c.stop();
    this.perFile.clear();
  }

  /** Full reconcile with ~/.claude. Concurrent calls share one run. */
  refresh(): Promise<void> {
    this.refreshing ??= this.runRefresh().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  private async runRefresh(): Promise<void> {
    const started = performance.now();
    try {
      const files = this.scanFiles();
      const infos = await this.options.source.list();
      this.options.resolver.clear();
      const seen = new Set<string>();
      const upserted: Entry[] = [];
      for (const info of infos) {
        seen.add(info.sessionId);
        const previous = this.entries.get(info.sessionId);
        const entry = this.build(info, files.get(info.sessionId) ?? null, previous);
        if (!previous || JSON.stringify(previous.summary) !== JSON.stringify(entry.summary) || previous.path !== entry.path) {
          upserted.push(entry);
        }
      }
      const removed = [...this.entries.keys()].filter((id) => !seen.has(id));
      const firstCompletion = !this.complete;
      this.complete = true;
      if (upserted.length || removed.length || firstCompletion) this.apply(upserted, removed);
      this.options.log(
        'debug',
        `Indexed ${infos.length} sessions in ${Math.round(performance.now() - started)}ms (${upserted.length} changed, ${removed.length} removed)`,
      );
    } catch (error) {
      this.options.log('error', `Session scan failed: ${(error as Error).message}`);
    }
  }

  /** Maps session id → transcript file for every top-level transcript under projects/. */
  private scanFiles(): Map<string, TranscriptFile> {
    const files = new Map<string, TranscriptFile>();
    let projectDirs: string[];
    try {
      projectDirs = readdirSync(this.options.projectsDir);
    } catch {
      return files;
    }
    for (const dir of projectDirs) {
      let names: string[];
      try {
        names = readdirSync(join(this.options.projectsDir, dir));
      } catch {
        continue;
      }
      for (const name of names) {
        const match = SESSION_FILE.exec(`${dir}/${name}`);
        if (!match) continue;
        const path = join(this.options.projectsDir, dir, name);
        const stat = statSync(path, { throwIfNoEntry: false });
        if (stat?.isFile()) files.set(match[2]!, { path, mtime: Math.round(stat.mtimeMs) });
      }
    }
    return files;
  }

  private build(info: RawSessionInfo, file: TranscriptFile | null, previous: Entry | undefined): Entry {
    const entrypoint = previous?.entrypoint ?? (file ? readEntrypoint(file.path) : null);
    const cwd = info.cwd ?? null;
    const location = cwd ? this.options.resolver.resolve(cwd) : null;
    const title = oneLine(info.customTitle || info.summary || info.firstPrompt || 'Untitled session', TITLE_MAX);
    const summary: SessionSummary = {
      id: info.sessionId,
      title,
      firstPrompt: info.firstPrompt ? oneLine(info.firstPrompt, 500) : null,
      customTitle: info.customTitle ?? null,
      cwd,
      projectRoot: location?.root ?? cwd ?? 'Unknown folder',
      gitBranch: info.gitBranch ?? null,
      worktree: location?.worktree
        ? { name: location.worktree.name, branch: this.options.resolver.branch(location) }
        : null,
      origin: originFromEntrypoint(entrypoint),
      createdAt: info.createdAt ?? null,
      updatedAt: info.lastModified,
      fileSize: info.fileSize ?? null,
      tag: info.tag ?? null,
    };
    return { summary, path: file?.path ?? previous?.path ?? null, mtime: file?.mtime ?? previous?.mtime ?? null, entrypoint };
  }

  private apply(upserted: Entry[], removed: string[]): void {
    const { db } = this.options;
    db.exec('BEGIN');
    try {
      for (const entry of upserted) {
        const s = entry.summary;
        this.statements.upsert.run(s.id, s.projectRoot, s.updatedAt, entry.path, entry.mtime, entry.entrypoint, JSON.stringify(s));
        this.entries.set(s.id, entry);
      }
      for (const id of removed) {
        this.statements.remove.run(id);
        this.entries.delete(id);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    this.options.onChange({ upserted: upserted.map((e) => e.summary), removed, complete: this.complete });
  }

  private fileChanged(sessionId: string, path: string): void {
    let runner = this.perFile.get(sessionId);
    if (!runner) {
      runner = coalesce(() => this.updateOne(sessionId, path), 200);
      this.perFile.set(sessionId, runner);
    }
    runner.trigger();
  }

  private async updateOne(sessionId: string, path: string): Promise<void> {
    try {
      if (!existsSync(path)) {
        if (this.entries.has(sessionId)) this.apply([], [sessionId]);
        this.options.onTranscriptChanged(sessionId);
        return;
      }
      const info = await this.options.source.info(sessionId);
      // A brand-new transcript has no prompt yet, so no summary; the next write will bring it in.
      if (info) {
        const stat = statSync(path, { throwIfNoEntry: false });
        const previous = this.entries.get(sessionId);
        const entry = this.build(info, { path, mtime: Math.round(stat?.mtimeMs ?? Date.now()) }, previous);
        if (!previous || JSON.stringify(previous.summary) !== JSON.stringify(entry.summary)) this.apply([entry], []);
      }
      this.options.onTranscriptChanged(sessionId);
    } catch (error) {
      this.options.log('warn', `Updating session ${sessionId} failed: ${(error as Error).message}`);
    }
  }
}
