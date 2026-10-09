export function createSnapshotEventQueue<TSnapshot, TEvent>(
  applySnapshot: (snapshot: TSnapshot) => void,
  applyEvent: (event: TEvent) => void,
) {
  let hasSnapshot = false;
  let pending: TEvent[] = [];

  return {
    event(event: TEvent): void {
      if (hasSnapshot) applyEvent(event);
      else pending.push(event);
    },
    snapshot(snapshot: TSnapshot): void {
      applySnapshot(snapshot);
      for (const event of pending) applyEvent(event);
      pending = [];
      hasSnapshot = true;
    },
  };
}
