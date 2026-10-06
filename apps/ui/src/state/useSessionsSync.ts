import { useEffect } from 'react';
import { useEngineConnection } from '../engine/useEngine.ts';
import { usePreferences } from './preferencesStore.ts';
import { toRows, useSessions } from './sessionsStore.ts';
import { startupSession } from './sidebarRows.ts';

const SELECTED_KEY = 'ui.selectedSession';

/** The startup choice is made once per window, not again after the engine reconnects. */
let started = false;

/**
 * Keeps the sessions store in sync with the engine: one snapshot per
 * connection, then deltas. Also persists the selected session and, when the
 * window opens, shows it again or New session (the Startup preference).
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
    const snapshot = client.call('sessions.list', {}).then((snapshot) => store.applySnapshot(snapshot));
    if (!started) {
      started = true;
      void Promise.all([client.call('appState.get', { key: SELECTED_KEY }), snapshot]).then(([{ value }]) => {
        const state = useSessions.getState();
        // Someone already picked something (a notification click, ⌘N): leave it.
        if (state.selectedId !== null || state.view !== 'session') return;
        const { startupView, sessionScope } = usePreferences.getState().prefs;
        const id = startupSession(toRows(state.sessions, state.live), value, startupView, sessionScope);
        if (id) state.select(id);
        else state.openNewSession();
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
