/**
 * The Agent SDK's transcript readers (listSessions, getSessionMessages, forkSession…) take the
 * config folder from process.env.CLAUDE_CONFIG_DIR when they run, with no option to pass one.
 * The lane runs calls for one folder at a time: calls for the folder in use run together, and a
 * call for another folder waits until they finish, then switches the variable.
 */
export class ConfigDirLane {
  private current: string | undefined | null = null;
  private active = 0;
  private readonly waiting: Array<{ dir: string | undefined; start: () => void }> = [];

  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  /** Runs `fn` with CLAUDE_CONFIG_DIR set to `dir` (unset when undefined). */
  async run<T>(dir: string | undefined, fn: () => Promise<T>): Promise<T> {
    await this.enter(dir);
    try {
      return await fn();
    } finally {
      this.leave();
    }
  }

  private enter(dir: string | undefined): Promise<void> {
    // Join the running group only when nobody waits, so another folder is never starved.
    if (this.active === 0 || (dir === this.current && this.waiting.length === 0)) {
      this.switchTo(dir);
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push({ dir, start: resolve }));
  }

  private leave(): void {
    this.active--;
    if (this.active > 0 || this.waiting.length === 0) return;
    // Start the next folder, with everyone else waiting for the same one.
    const dir = this.waiting[0]!.dir;
    this.switchTo(dir);
    for (let i = 0; i < this.waiting.length; ) {
      if (this.waiting[i]!.dir === dir) {
        this.active++;
        this.waiting.splice(i, 1)[0]!.start();
      } else i++;
    }
  }

  private switchTo(dir: string | undefined): void {
    this.current = dir;
    if (dir === undefined) delete this.env.CLAUDE_CONFIG_DIR;
    else this.env.CLAUDE_CONFIG_DIR = dir;
  }
}
