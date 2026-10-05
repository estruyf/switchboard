import { useEffect, useState } from 'react';
import type { TranscriptMessage } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';

export interface TranscriptState {
  status: 'loading' | 'ready';
  messages: TranscriptMessage[];
}

/** Watches one session's transcript: a full load first, then live appends while the file changes. */
export function useTranscript(sessionId: string): TranscriptState {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<TranscriptState>({ status: 'loading', messages: [] });

  useEffect(() => {
    if (!client) return;
    const off = client.on('transcript.updated', (update) => {
      if (update.sessionId !== sessionId) return;
      setState((prev) => ({
        status: 'ready',
        messages: update.mode === 'replace' ? update.messages : [...prev.messages, ...update.messages],
      }));
    });
    void client.call('transcript.watch', { sessionId });
    return () => {
      off();
      void client.call('transcript.unwatch', { sessionId }).catch(() => {});
    };
  }, [client, sessionId]);

  return state;
}
