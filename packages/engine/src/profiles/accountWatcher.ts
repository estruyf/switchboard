import { statSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';
import { coalesce } from '../util/coalesce.ts';

/**
 * Notices when Claude Code rewrites a profile's `.claude.json`, such as after `/login` in a
 * terminal, so the profile's "signed in as" shows up without restarting. Claude Code replaces the
 * file rather than writing into it, so the folder is watched, not the file; a slow mtime poll
 * covers folders that didn't exist yet and watchers that stopped.
 */
export class AccountWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly mtimes = new Map<string, number>();
  private poll: ReturnType<typeof setInterval> | undefined;
  private readonly check;

  constructor(
    /** The account files to follow; read again on `sync()`. */
    private readonly files: () => string[],
    onChange: () => void,
    private readonly pollMs = 3000,
  ) {
    this.check = coalesce(onChange, 200);
  }

  start(): void {
    this.sync();
    this.poll = setInterval(() => this.pollMtimes(), this.pollMs);
    this.poll.unref?.();
  }

  /** Profiles were added or removed: follow their files (or stop following them). */
  sync(): void {
    const files = this.files();
    const dirs = new Map<string, Set<string>>();
    for (const file of files) {
      const names = dirs.get(dirname(file)) ?? new Set<string>();
      names.add(basename(file));
      dirs.set(dirname(file), names);
    }
    for (const [dir, watcher] of this.watchers) {
      if (!dirs.has(dir)) {
        watcher.close();
        this.watchers.delete(dir);
      }
    }
    for (const [dir, names] of dirs) {
      if (this.watchers.has(dir)) continue;
      try {
        // The home folder sees plenty of other writes; only the account file (and its temp copies) count.
        const watcher = watch(dir, (_event, filename) => {
          if (!filename || [...names].some((name) => filename.startsWith(name))) this.check.trigger();
        });
        watcher.on('error', () => {
          watcher.close();
          this.watchers.delete(dir);
        });
        this.watchers.set(dir, watcher);
      } catch {
        // Folder missing: the poll notices the file once Claude Code creates it.
      }
    }
    for (const file of [...this.mtimes.keys()]) if (!files.includes(file)) this.mtimes.delete(file);
    for (const file of files) if (!this.mtimes.has(file)) this.mtimes.set(file, mtime(file));
  }

  private pollMtimes(): void {
    let changed = false;
    for (const [file, before] of this.mtimes) {
      const now = mtime(file);
      if (now !== before) {
        this.mtimes.set(file, now);
        changed = true;
      }
    }
    if (changed) this.check.trigger();
    // Retry watchers that failed or errored.
    if (this.watchers.size < new Set(this.files().map(dirname)).size) this.sync();
  }

  stop(): void {
    this.check.stop();
    if (this.poll) clearInterval(this.poll);
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }
}

const mtime = (file: string) => statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0;
