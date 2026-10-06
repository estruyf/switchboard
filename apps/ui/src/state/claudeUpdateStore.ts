import { useEffect } from 'react';
import { create } from 'zustand';
import type { ClaudeUpdateState } from '@switchboard/protocol/client';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';

interface ClaudeUpdateStore {
  /** Null until the engine has answered. */
  state: ClaudeUpdateState | null;
  /** Why the last request was refused (busy, can't update this install); cleared by the next one. */
  refused: string | null;
  client: EngineClient | null;
  check(): void;
  update(): void;
  dismiss(): void;
  setEnabled(enabled: boolean): void;
}

export const useClaudeUpdate = create<ClaudeUpdateStore>()((set, get) => {
  const send = (call: (client: EngineClient) => Promise<unknown>) => {
    const client = get().client;
    if (!client) return;
    set({ refused: null });
    call(client).catch((error: Error) => set({ refused: error.message }));
  };
  return {
    state: null,
    refused: null,
    client: null,
    check: () => send((c) => c.call('claudeUpdate.check', {})),
    update: () => send((c) => c.call('claudeUpdate.update', {})),
    dismiss: () => send((c) => c.call('claudeUpdate.dismiss', {})),
    setEnabled: (enabled) => send((c) => c.call('claudeUpdate.setEnabled', { enabled })),
  };
});

/** Follows the engine's Claude Code check (loaded once per connection). */
export function useClaudeUpdateSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    useClaudeUpdate.setState({ client });
    if (!client) return;
    const off = client.on('claudeUpdate.changed', (state) => useClaudeUpdate.setState({ state }));
    void client.call('claudeUpdate.get', {}).then((state) => useClaudeUpdate.setState({ state }));
    return off;
  }, [client]);
}
