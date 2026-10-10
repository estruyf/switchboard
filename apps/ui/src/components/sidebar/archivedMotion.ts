/** Whether the system asks for less motion: the Archived header then jumps between the dock and the list. */
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * Calls `frame` with an eased progress from 0 to 1 over `ms`: once at once (so the first paint already has the start
 * position), then on every animation frame. `done` runs after the last frame. Returns a function that stops it.
 */
export function tween(ms: number, frame: (progress: number) => void, done: () => void): () => void {
  const start = performance.now();
  frame(0);
  let id = requestAnimationFrame(function step(now) {
    const t = Math.min(1, (now - start) / ms);
    frame(easeOut(t));
    if (t < 1) id = requestAnimationFrame(step);
    else done();
  });
  return () => {
    cancelAnimationFrame(id);
    done();
  };
}
