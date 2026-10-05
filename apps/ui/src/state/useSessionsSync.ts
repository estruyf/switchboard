import { useEffect } from 'react';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useSessions } from './sessionsStore.ts';

const SELECTED_KEY = 'ui.selectedSession';

/**
 * Keeps the sessions store in sync with the engine: one snapshot per
 * connection, then deltas. Also restores and persists the selected session.
 */
export function useSessionsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;

  useEffect(() => {
    if (!client) return;
    const store = useSessions.getState();
    // Subscribe before asking for the snapshot so no delta can fall in between.
    const offChanged = client.on('sessions.changed', (change) => useSessions.getState().applyChanged(change));
    const offLive = client.on('sessions.live', ({ live }) => useSessions.getState().setLive(live));
    void client.call('sessions.list', {}).then((snapshot) => store.applySnapshot(snapshot));
    if (store.selectedId === null) {
      void client.call('appState.get', { key: SELECTED_KEY }).then(({ value }) => {
        if (typeof value === 'string' && useSessions.getState().selectedId === null) useSessions.getState().select(value);
      });
    }
    return () => {
      offChanged();
      offLive();
    };
  }, [client]);

  const selectedId = useSessions((s) => s.selectedId);
  useEffect(() => {
    if (client && selectedId) void client.call('appState.set', { key: SELECTED_KEY, value: selectedId });
  }, [client, selectedId]);
}
