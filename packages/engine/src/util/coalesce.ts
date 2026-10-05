/**
 * Runs `task` at most once per `intervalMs` while triggers keep arriving, and
 * never runs two copies concurrently. A trigger during a run schedules exactly
 * one follow-up run. Unlike a debounce, a constantly-written file still
 * updates every `intervalMs` instead of never.
 */
export function coalesce(task: () => Promise<void> | void, intervalMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  let stopped = false;

  const run = async () => {
    timer = undefined;
    running = true;
    try {
      await task();
    } finally {
      running = false;
      if (again && !stopped) {
        again = false;
        timer = setTimeout(run, intervalMs);
      }
    }
  };

  return {
    trigger() {
      if (stopped) return;
      if (running) again = true;
      else if (!timer) timer = setTimeout(run, intervalMs);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
