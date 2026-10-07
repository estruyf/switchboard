/** The parts of a terminal tab these helpers look at (a `TerminalInfo`). */
interface TerminalLike {
  id: string;
  kind: 'shell' | 'claude' | 'action';
  title: string;
  exitCode: number | null;
  startedAt: number;
}

export type RunState = 'running' | 'done' | 'failed';

/** What an action's run strip says: "Running", "Exited 0" or "Failed (exit 1)". */
export function runStatus(exitCode: number | null): { state: RunState; label: string } {
  if (exitCode === null) return { state: 'running', label: 'Running' };
  if (exitCode === 0) return { state: 'done', label: 'Exited 0' };
  return { state: 'failed', label: `Failed (exit ${exitCode})` };
}

/**
 * The status a tab shows next to its title. A running action has a working dot; anything that failed
 * has an error dot and "exit N"; a finished tab says "exit 0" quietly. A plain shell or Claude that is
 * still running shows nothing.
 */
export function tabStatus(terminal: Pick<TerminalLike, 'kind' | 'exitCode'>): { dot: 'running' | 'failed' | null; note: string | null } {
  if (terminal.exitCode === null) return { dot: terminal.kind === 'action' ? 'running' : null, note: null };
  return { dot: terminal.exitCode === 0 ? null : 'failed', note: `exit ${terminal.exitCode}` };
}

/** Elapsed time as a stopwatch shows it: `0:07`, `12:34`, `1:02:03`. */
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Setup actions run in a new worktree under this prefix (the engine's `Setup: <name>`). */
const SETUP_PREFIX = 'Setup: ';

/**
 * The command an action's tab runs, from the project's action definitions (matched by name, the tab's
 * title). Tabs that don't come from a definition (git commands, a deleted action) fall back to the title.
 */
export function actionCommand(title: string, actions: ReadonlyArray<{ name: string; command: string; type: string }>): string {
  const name = title.startsWith(SETUP_PREFIX) ? title.slice(SETUP_PREFIX.length) : title;
  return actions.find((a) => a.type === 'shell' && a.name === name)?.command ?? title;
}

/** When the current run of a terminal started, and when it ended (null while it runs, or when it ended before we saw it). */
export interface RunTimes {
  startedAt: number;
  endedAt: number | null;
}

/**
 * Follows each terminal's current run from one list to the next, so the run strip can show how long it
 * has run. A terminal's first run starts at its `startedAt`; a Restart (exit code back to null) starts a
 * new run now; an exit seen here ends it now. Terminals that are gone are dropped.
 */
export function trackRuns(previous: ReadonlyMap<string, RunTimes>, before: ReadonlyMap<string, Pick<TerminalLike, 'exitCode'>>, list: readonly TerminalLike[], now: number): Map<string, RunTimes> {
  const runs = new Map<string, RunTimes>();
  for (const t of list) {
    const run = previous.get(t.id);
    const was = before.get(t.id);
    if (!run || !was) runs.set(t.id, { startedAt: t.startedAt, endedAt: null });
    else if (was.exitCode !== null && t.exitCode === null) runs.set(t.id, { startedAt: now, endedAt: null });
    else if (was.exitCode === null && t.exitCode !== null) runs.set(t.id, { ...run, endedAt: now });
    else runs.set(t.id, run);
  }
  return runs;
}
