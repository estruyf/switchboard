import { describe, expect, it } from 'vitest';
import { createSnapshotEventQueue } from './snapshotEvents.ts';

describe('createSnapshotEventQueue', () => {
  it('applies events received during the initial snapshot after the snapshot', () => {
    const calls: string[] = [];
    const queue = createSnapshotEventQueue(
      (snapshot: string) => calls.push(`snapshot:${snapshot}`),
      (event: string) => calls.push(`event:${event}`),
    );

    queue.event('newer');
    queue.snapshot('cached');
    queue.event('latest');

    expect(calls).toEqual(['snapshot:cached', 'event:newer', 'event:latest']);
  });
});
