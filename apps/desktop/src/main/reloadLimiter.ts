/**
 * Decides whether a window whose renderer crashed is reloaded. A page that crashes again right away
 * would otherwise reload forever, so at most `limit` reloads happen within `windowMs`.
 */
export class ReloadLimiter {
  #reloads: number[] = [];

  constructor(
    private readonly limit = 3,
    private readonly windowMs = 60_000,
  ) {}

  /** Records the crash; true when the window should reload. A `clean-exit` isn't a crash. */
  shouldReload(reason: string, now = Date.now()): boolean {
    if (reason === 'clean-exit') return false;
    this.#reloads = this.#reloads.filter((at) => now - at < this.windowMs);
    if (this.#reloads.length >= this.limit) return false;
    this.#reloads.push(now);
    return true;
  }
}
