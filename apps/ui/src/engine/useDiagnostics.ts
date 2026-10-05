import { useEffect, useState } from 'react';
import type { LogEntry, SystemInfo } from '@switchboard/protocol/client';
import type { EngineClient } from './connection.ts';
import { useEngineConnection } from './useEngine.ts';

export interface Diagnostics {
  info: SystemInfo | null;
  /** Median round trip of a burst of pings, in ms. */
  pingMs: number | null;
  logs: LogEntry[];
  error: string | null;
}

const MAX_LOGS = 200;
/** Ready is reported once per connection, even though StrictMode runs effects twice in dev. */
let lastReportedGeneration = 0;

async function measurePing(client: EngineClient, samples = 20): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await client.call('system.ping', { sentAt: Date.now() });
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return Math.round(times[Math.floor(times.length / 2)]! * 100) / 100;
}

/** Loads engine diagnostics for the current connection and re-runs after every reconnect. */
export function useDiagnostics(): Diagnostics & { refreshPing: () => void } {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const generation = connection.status === 'connected' ? connection.generation : 0;
  const [state, setState] = useState<Diagnostics>({ info: null, pingMs: null, logs: [], error: null });
  const [pingRun, setPingRun] = useState(0);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const off = client.on('engine.log', (entry) =>
      setState((s) => ({ ...s, logs: [...s.logs, entry].slice(-MAX_LOGS) })),
    );
    let connectedAt = 0;
    // system.info waits on the login shell and `claude --version`; the ping shows when the engine itself is usable.
    const ping = measurePing(client).then((pingMs) => ((connectedAt = Date.now()), pingMs));
    Promise.all([client.call('system.info', {}), ping])
      .then(([info, pingMs]) => {
        if (cancelled) return;
        setState((s) => ({ ...s, info, pingMs, error: null }));
        if (generation > lastReportedGeneration) {
          lastReportedGeneration = generation;
          window.switchboard?.reportReady({
            connectedAt,
            engineVersion: info.engineVersion,
            claudeVersion: info.claude?.version ?? null,
            pingMs,
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setState((s) => ({ ...s, error: error instanceof Error ? error.message : String(error) }));
      });
    return () => {
      cancelled = true;
      off();
    };
  }, [client, generation]);

  useEffect(() => {
    if (!client || pingRun === 0) return;
    let cancelled = false;
    void measurePing(client).then((pingMs) => !cancelled && setState((s) => ({ ...s, pingMs })));
    return () => {
      cancelled = true;
    };
  }, [client, pingRun]);

  return { ...state, refreshPing: () => setPingRun((n) => n + 1) };
}
