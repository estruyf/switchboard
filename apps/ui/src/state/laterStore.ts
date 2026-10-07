import { useEffect } from 'react';
import { create } from 'zustand';
import type { LaterDraft, LaterItem } from '@switchboard/protocol/client';
import { engineConnection } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { basename } from '../lib/format.ts';
import { useProjects } from './projectsStore.ts';
import { useSessions } from './sessionsStore.ts';
import { toast } from './toastStore.ts';

/** Prompts parked instead of starting a session (the focus limit's Later list). The engine keeps them. */
interface LaterState {
  /** Every saved prompt, newest first. */
  items: LaterItem[];
  loaded: boolean;
  /** The sidebar's Later group is expanded. */
  open: boolean;
  /** New session should fill itself in from this item (a click on it in the sidebar or "Use"). */
  request: { item: LaterItem; seq: number } | null;
  replace(items: LaterItem[]): void;
  toggleOpen(): void;
  /** Opens New session filled in from an item, so it can be checked before it starts. */
  use(item: LaterItem): void;
  /** New session takes the request once. */
  take(): LaterItem | null;
}

let seq = 0;

export const useLater = create<LaterState>()((set, get) => ({
  items: [],
  loaded: false,
  open: true,
  request: null,
  replace: (items) => set({ items, loaded: true }),
  toggleOpen: () => set((s) => ({ open: !s.open })),
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

/** Loads the list once per connection and follows changes from every window. */
export function useLaterSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('later.changed', ({ items }) => useLater.getState().replace(items));
    void client.call('later.list', {}).then(({ items }) => useLater.getState().replace(items), () => {});
    return off;
  }, [client]);
}

const clientNow = () => {
  const state = engineConnection.getSnapshot();
  if (state.status !== 'connected') throw new Error('Not connected to the engine');
  return state.client;
};

const projectName = (cwd: string) => useProjects.getState().projects.get(cwd)?.name ?? basename(cwd);

/** Saves a prompt for later and says so, with Undo (which brings the prompt back into New session). */
export async function saveForLater(draft: LaterDraft): Promise<LaterItem> {
  const client = clientNow();
  const { item } = await client.call('later.add', { draft });
  toast(`Saved for later in ${projectName(item.cwd)}`, {
    icon: 'bookmark',
    undo: () => {
      void client.call('later.remove', { id: item.id }).catch(() => {});
      useLater.getState().use(item);
    },
  });
  return item;
}

/** Removes an item without asking; Undo puts it back in its place. `quiet` skips the toast (it was started). */
export async function removeFromLater(item: LaterItem, quiet = false): Promise<void> {
  const client = clientNow();
  await client.call('later.remove', { id: item.id });
  if (quiet) return;
  toast('Removed from Later', {
    undo: () => {
      const { id, createdAt, ...draft } = item;
      void client.call('later.add', { draft, id, createdAt }).catch(() => {});
    },
  });
}
