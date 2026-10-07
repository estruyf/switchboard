import { describe, expect, it } from 'vitest';
import { RendererQueue } from './rendererQueue.ts';

describe('RendererQueue', () => {
  it('keeps every link but only the last session or Settings request, in order', () => {
    const queue = new RendererQueue();
    queue.push('deep-link', { link: 1 });
    queue.push('select-session', 'a', { latestOnly: true });
    queue.push('deep-link', { link: 2 });
    queue.push('open-settings', null, { latestOnly: true });
    queue.push('select-session', 'b', { latestOnly: true });
    queue.push('open-settings', 'about', { latestOnly: true });
    expect(queue.drain()).toEqual([
      { channel: 'deep-link', payload: { link: 1 } },
      { channel: 'deep-link', payload: { link: 2 } },
      { channel: 'select-session', payload: 'b' },
      { channel: 'open-settings', payload: 'about' },
    ]);
    expect(queue.size).toBe(0);
    expect(queue.drain()).toEqual([]);
  });
});
