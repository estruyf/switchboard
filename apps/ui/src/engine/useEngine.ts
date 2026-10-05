import { useSyncExternalStore } from 'react';
import { engineConnection, type ConnectionState } from './connection.ts';

export function useEngineConnection(): ConnectionState {
  return useSyncExternalStore(engineConnection.subscribe, engineConnection.getSnapshot);
}
