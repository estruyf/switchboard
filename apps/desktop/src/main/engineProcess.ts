import { utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron';

export interface EngineProcessOptions {
  entry: string;
  dataDir: string;
  /** Called after an unexpected exit, once the replacement process is running. */
  onRestarted: () => void;
  /** Requests from the engine that need the main process (e.g. moving files to the Trash). Returns the reply. */
  onRequest?: (message: unknown) => Promise<unknown> | undefined;
}

/** Owns the engine utilityProcess and restarts it with backoff if it dies. */
export class EngineProcess {
  private child: UtilityProcess | undefined;
  private queued: MessagePortMain[] = [];
  private consecutiveCrashes = 0;
  private stableTimer: NodeJS.Timeout | undefined;
  private stopping = false;

  constructor(private readonly options: EngineProcessOptions) {}

  start(): void {
    const child = utilityProcess.fork(this.options.entry, ['--data-dir', this.options.dataDir], {
      serviceName: 'Switchboard Engine',
      stdio: 'inherit',
    });
    this.child = child;
    for (const port of this.queued.splice(0)) child.postMessage({ type: 'connect' }, [port]);
    child.on('message', (message: unknown) => {
      void this.options.onRequest?.(message)?.then((reply) => {
        if (reply !== undefined && this.child === child) child.postMessage(reply);
      });
    });

    // A process that stays up for a minute resets the backoff.
    this.stableTimer = setTimeout(() => (this.consecutiveCrashes = 0), 60_000);

    child.once('exit', (code) => {
      clearTimeout(this.stableTimer);
      if (this.child === child) this.child = undefined;
      if (this.stopping) return;
      const delay = Math.min(10_000, 200 * 2 ** this.consecutiveCrashes++);
      console.error(`[main] engine exited with code ${code}; restarting in ${delay}ms`);
      setTimeout(() => {
        if (this.stopping) return;
        this.start();
        this.options.onRestarted();
      }, delay);
    });
  }

  /** Hands a window's port to the engine (queued while a restart is pending). */
  connect(port: MessagePortMain): void {
    if (this.child) this.child.postMessage({ type: 'connect' }, [port]);
    else this.queued.push(port);
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** Kills the process without stopping the supervisor (used by the smoke test to exercise restarts). */
  crash(): void {
    this.child?.kill();
  }

  stop(): void {
    this.stopping = true;
    clearTimeout(this.stableTimer);
    this.child?.kill();
  }
}
