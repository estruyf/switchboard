import { useEffect } from 'react';
import { create } from 'zustand';
import type { LaterDraft, LaterItem, QueueStarted, QueueWaitFor } from '@switchboard/protocol/client';
import { engineConnection } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { passFocusGate } from './focusGate.ts';
import { moveTarget } from './queue.ts';
import { useSessions } from './sessionsStore.ts';
import { toast } from './toastStore.ts';

// The queue. It keeps the name it started with (the Later list) inside: the RPCs, the table and this store.

interface LaterState {
  /** The queue in order, first to start first. */
  items: LaterItem[];
  /** Started items and their sessions, for the items still waiting on them. */
  started: QueueStarted[];
  loaded: boolean;
  /** New session should fill itself in from this item (a click on it, or Edit in New session). */
  request: { item: LaterItem; seq: number } | null;
  replace(items: LaterItem[], started: QueueStarted[]): void;
  /** Opens New session filled in from an item, so it can be checked (and changed) before it starts. */
  use(item: LaterItem): void;
  /** New session takes the request once. */
  take(): LaterItem | null;
}

let seq = 0;

export const useLater = create<LaterState>()((set, get) => ({
  items: [],
  started: [],
  loaded: false,
  request: null,
  replace: (items, started) => set({ items, started, loaded: true }),
  use: (item) => {
    set({ request: { item, seq: ++seq } });
    useSessions.getState().openNewSession();
  },
  take: () => {
    const request = get().request;
    if (request) set({ request: null });
    return request?.item ?? null;
  },
}));

/** Loads the queue once per connection and follows changes from every window. */
export function useLaterSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('later.changed', ({ items, started }) => useLater.getState().replace(items, started));
    void client.call('later.list', {}).then(({ items, started }) => useLater.getState().replace(items, started), () => {});
    return off;
  }, [client]);
}

const clientNow = () => {
  const state = engineConnection.getSnapshot();
  if (state.status !== 'connected') throw new Error('Not connected to the engine');
  return state.client;
};

/** Puts an item back where it was, as it was (Undo). */
const restore = (item: LaterItem, index = item.position) => {
  const { id, createdAt, position: _position, waitFor, ...draft } = item;
  return clientNow().call('later.add', { draft, id, createdAt, index, waitFor });
};

/**
 * Adds a prompt to the end of the queue and says so, with Undo (which takes it off again and brings the prompt back
 * into New session). `waitFor` defaults to any session in its project. `replacing`: an item edited in New session
 * and queued again keeps its place (and Undo brings back the item as it was).
 */
export async function addToQueue(draft: LaterDraft, options: { waitFor?: QueueWaitFor; replacing?: LaterItem | null } = {}): Promise<LaterItem> {
  const client = clientNow();
  const { replacing } = options;
  const index = replacing ? useLater.getState().items.findIndex((i) => i.id === replacing.id) : -1;
  const { item } = await client.call('later.add', {
    draft,
    ...(options.waitFor ? { waitFor: options.waitFor } : replacing ? { waitFor: replacing.waitFor } : {}),
    ...(replacing && index !== -1 ? { id: replacing.id, createdAt: replacing.createdAt, index } : {}),
  });
  toast(replacing && index !== -1 ? 'Updated in the queue' : 'Added to the queue', {
    icon: 'queue',
    undo: () => {
      if (replacing && index !== -1) void restore(replacing, index).catch(() => {});
      else void client.call('later.remove', { id: item.id }).catch(() => {});
      useLater.getState().use(item);
    },
  });
  return item;
}

/**
 * Removes an item without asking; Undo puts it back in its place. `quiet` skips the toast. `startedAs`: it was
 * started from New session (after an edit) as this session, which items waiting on it now follow.
 */
export async function removeFromQueue(item: LaterItem, quiet = false, startedAs?: string): Promise<void> {
  const index = useLater.getState().items.findIndex((i) => i.id === item.id);
  await clientNow().call('later.remove', { id: item.id, ...(startedAs ? { startedAs } : {}) });
  if (quiet) return;
  toast('Removed from the queue', { undo: () => void restore(item, index === -1 ? item.position : index).catch(() => {}) });
}

/** ⌥↑ / ⌥↓ and Move to top. Nothing happens at the ends. */
export async function moveInQueue(item: LaterItem, move: -1 | 1 | 'top'): Promise<void> {
  const to = moveTarget(
    useLater.getState().items.map((i) => i.id),
    item.id,
    move,
  );
  if (to !== null) await clientNow().call('later.reorder', { id: item.id, toIndex: to });
}

/** Moves an item to a place in the whole queue (a drag). */
export async function reorderQueue(id: string, toIndex: number): Promise<void> {
  await clientNow().call('later.reorder', { id, toIndex });
}

export async function setWaitFor(item: LaterItem, waitFor: QueueWaitFor): Promise<void> {
  await clientNow().call('later.update', { id: item.id, waitFor });
}

/**
 * Starts a queued item: the focus limit's gate first (at the limit it can only stay queued), then the session
 * starts from the item's draft and opens, and the item leaves the queue. Returns the session, or null when
 * nothing started. A failure is said in a toast and the item stays queued.
 */
export async function startQueued(item: LaterItem): Promise<string | null> {
  const outcome = await passFocusGate({ saveForLater: async () => {}, saveLabel: 'Keep it queued' });
  if (outcome !== 'start') return null;
  try {
    const { sessionId } = await clientNow().call('later.start', { id: item.id });
    useSessions.getState().select(sessionId);
    return sessionId;
  } catch (error) {
    toast(`Couldn't start it: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
