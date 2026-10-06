import { useEffect } from 'react';
import { create } from 'zustand';
import type { ClaudeProfile, ProfilesSnapshot } from '@switchboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';

interface ProfilesState {
  profiles: ClaudeProfile[];
  defaultId: string;
  loaded: boolean;
  set(snapshot: ProfilesSnapshot): void;
}

export const useProfiles = create<ProfilesState>()((set) => ({
  profiles: [],
  defaultId: 'default',
  loaded: false,
  set: ({ profiles, defaultId }) => set({ profiles, defaultId, loaded: true }),
}));

/** More than one profile: only then does the app show which one a session or project uses. */
export const useMultipleProfiles = () => useProfiles((s) => s.profiles.length > 1);

export const useProfile = (id: string | null | undefined) => useProfiles((s) => s.profiles.find((p) => p.id === (id ?? s.defaultId)));

/** Loads the profiles once per connection and follows changes. */
export function useProfilesSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('profiles.changed', (snapshot) => useProfiles.getState().set(snapshot));
    void client.call('profiles.list', {}).then((snapshot) => useProfiles.getState().set(snapshot));
    return off;
  }, [client]);
}
