/** A message from main to a window's renderer: an IPC channel and its argument. */
export interface RendererMessage {
  channel: string;
  payload: unknown;
}

/**
 * Holds messages for a window whose page hasn't loaded yet (one just created, or reloading): sent before
 * the renderer listens, they would be lost. Main sends them when the renderer reports ready.
 */
export class RendererQueue {
  #messages: RendererMessage[] = [];

  /**
   * Queues a message. With `latestOnly`, it replaces a queued one on the same channel: for "open this
   * session" or "open Settings" only the last request matters. Links are kept, each one shows something.
   */
  push(channel: string, payload: unknown, options: { latestOnly?: boolean } = {}): void {
    if (options.latestOnly) this.#messages = this.#messages.filter((message) => message.channel !== channel);
    this.#messages.push({ channel, payload });
  }

  /** Everything queued, oldest first, leaving the queue empty. */
  drain(): RendererMessage[] {
    return this.#messages.splice(0);
  }

  get size(): number {
    return this.#messages.length;
  }
}
