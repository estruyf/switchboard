import { useEffect } from 'react';
import { create } from 'zustand';
import type { LiveSession, SessionsChanged, SessionsSnapshot } from '@switchboard/protocol/client';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { usePreferences } from './preferencesStore.ts';
import { toRows, useSessions } from './sessionsStore.ts';
import { startupSession } from './sidebarRows.ts';
import { createSnapshotEventQueue } from './snapshotEvents.ts';
import { loadDrafts } from './useDraftsSync.ts';

const SELECTED_KEY = 'ui.selectedSession';

/** Each connection's first sessions list, so the ready report can count it instead of asking again. */
const snapshots = new WeakMap<EngineClient, Promise<SessionsSnapshot>>();

/** The sessions list this connection loaded first (asked for here if the sync hasn't asked yet). */
export function firstSnapshot(client: EngineClient): Promise<SessionsSnapshot> {
  let snapshot = snapshots.get(client);
  if (!snapshot) {
    snapshot = client.call('sessions.list', {});
    snapshots.set(client, snapshot);
  }
  return snapshot;
}

/**
 * The startup choice is made once per window, not again after the engine reconnects. `starting` covers
 * the attempt in flight; `started` is set once it has been applied, so a connection that drops before
 * then (the call is rejected) lets the next one try again.
 */
let starting = false;
let started = false;
/** Whether the startup choice has been applied in this window; until then the selection isn't saved. */
const useStartup = create<{ decided: boolean }>()(() => ({ decided: false }));

/**
 * Keeps the sessions store in sync with the engine: one snapshot per
 * connection, then deltas. Also persists the selected session and, when the
 * window opens, shows Home, that session again or New session (the Startup preference).
 */
export function useSessionsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;

  useEffect(() => {
    if (!client) return;
    const store = useSessions.getState();
    const events = createSnapshotEventQueue(
      (snapshot: SessionsSnapshot) => store.applySnapshot(snapshot),
      (event: { kind: 'changed'; change: SessionsChanged } | { kind: 'live'; live: LiveSession[] }) => {
        if (event.kind === 'changed') store.applyChanged(event.change);
        else store.setLive(event.live);
      },
    );
    // Events can arrive before the snapshot response; replay them after it so stale data cannot win.
    const offChanged = client.on('sessions.changed', (change) => events.event({ kind: 'changed', change }));
    const offLive = client.on('sessions.live', ({ live }) => events.event({ kind: 'live', live }));
    // The saved drafts come in with the first list, so its rows show their unsent messages from the first paint.
    const snapshot = Promise.all([firstSnapshot(client), loadDrafts(client)]).then(([snapshot]) => events.snapshot(snapshot));
    if (!started && !starting) {
      starting = true;
      void Promise.all([client.call('appState.get', { key: SELECTED_KEY }), snapshot])
        .then(([{ value }]) => {
          started = true;
          const state = useSessions.getState();
          // Someone already picked something (a notification click, ⌘N): leave it.
          if (state.selectedId !== null || state.view !== 'session') return;
          const { startupView, sessionScope } = usePreferences.getState().prefs;
          const id = startupSession(toRows(state.sessions, state.live), value, startupView, sessionScope);
          if (id) state.select(id);
          else if (startupView === 'home') state.goHome();
          else state.openNewSession();
        })
        .catch(() => {})
        .finally(() => {
          starting = false;
          // The choice is made (or the connection dropped): from now on the selection is worth saving.
          if (started) useStartup.setState({ decided: true });
        });
    }
    return () => {
      offChanged();
      offLive();
    };
  }, [client]);

  // Saved only after the startup choice, so the empty selection the window opens with doesn't wipe
  // the session to reopen. Closing a session (or going Home) saves the empty selection too.
  const selectedId = useSessions((s) => s.selectedId);
  const decided = useStartup((s) => s.decided);
  useEffect(() => {
    if (client && decided) void client.call('appState.set', { key: SELECTED_KEY, value: selectedId }).catch(() => {});
  }, [client, decided, selectedId]);
}
