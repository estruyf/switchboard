/** One smoke step's outcome, as written to result.json and printed by scripts/smoke.ts. */
export interface SmokeStepResult {
  label: string;
  /** "ok…" when it passed; anything else says what went wrong. */
  result: string;
  ok: boolean;
  ms: number;
}

export interface SmokeStepOptions {
  /** How long the step may take before the run gives up on it. */
  timeoutMs?: number;
  /** Put the window back in a known state afterwards (close a dialog or menu the step left open). Off for steps run inside another step. */
  cleanup?: boolean;
}

/** The result of a step skipped because an earlier one timed out (see `SmokeRun.stoppedBy`). */
export const NOT_RUN = 'not run';

/** Whether a step's result counts as a pass. */
export function isPass(result: string): boolean {
  return result.startsWith('ok');
}

/**
 * Runs the smoke steps one after another: times each one, turns a throw into a failed result, and stops
 * the run when a step takes too long. A step that times out may still be driving the window, so the
 * steps after it are reported as not run instead of failing one by one on a page in an unknown state.
 */
export class SmokeRun {
  readonly steps: SmokeStepResult[] = [];
  /** The step that timed out and stopped the run, if one did. */
  stoppedBy: string | null = null;

  constructor(
    private readonly options: {
      /** Called after each step (unless it opts out); returns what it had to close, if anything. */
      cleanup?: () => Promise<string | null>;
      log?: (line: string) => void;
      defaultTimeoutMs?: number;
    } = {},
  ) {}

  async step(label: string, run: () => Promise<string | boolean>, options: SmokeStepOptions = {}): Promise<string> {
    if (this.stoppedBy) return this.record(label, NOT_RUN, 0, false);
    const timeoutMs = options.timeoutMs ?? this.options.defaultTimeoutMs ?? 30_000;
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    let result: string;
    try {
      const outcome = await Promise.race([run(), timedOut]);
      if (outcome === 'timeout') {
        this.stoppedBy = label;
        result = `failed: timed out after ${Math.round(timeoutMs / 1000)}s`;
      } else {
        result = outcome === true ? 'ok' : outcome === false ? 'failed' : outcome;
      }
    } catch (error) {
      result = `failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      clearTimeout(timer);
    }
    const ms = Math.round(performance.now() - started);
    if (!this.stoppedBy && options.cleanup !== false && this.options.cleanup) {
      const closed = await this.options.cleanup().catch((error: Error) => `cleanup failed: ${error.message}`);
      if (closed) this.options.log?.(`[smoke] after "${label}": ${closed}`);
    }
    return this.record(label, result, ms);
  }

  /** The steps that took longest, slowest first. */
  slowest(count: number): SmokeStepResult[] {
    return [...this.steps].sort((a, b) => b.ms - a.ms).slice(0, count);
  }

  private record(label: string, result: string, ms: number, log = true): string {
    const ok = isPass(result);
    this.steps.push({ label, result, ok, ms });
    if (log) this.options.log?.(`[smoke] ${ok ? '✓' : '✗'} ${label} (${ms}ms)${ok ? '' : `: ${result}`}`);
    return result;
  }
}
