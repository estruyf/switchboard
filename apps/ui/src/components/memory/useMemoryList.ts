import { useCallback, useEffect, useState } from 'react';
import type { MemoryList } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';

/**
 * A project's memory and instruction files, read when shown and again whenever Switchboard changes them
 * (`memory.changed`) or `reload` is called (Claude Code writes memory on its own, outside Switchboard).
 */
export function useMemoryList(root: string | null): { list: MemoryList | null; error: string | null; reload(): void } {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<{ root: string | null; list: MemoryList | null; error: string | null }>({ root: null, list: null, error: null });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!client || !root) return;
    let cancelled = false;
    client.call('memory.list', { root }).then(
      (list) => !cancelled && setState({ root, list, error: null }),
      (error: Error) => !cancelled && setState({ root, list: null, error: error.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [client, root, version]);

  useEffect(() => {
    if (!client || !root) return;
    return client.on('memory.changed', (change) => change.root === root && reload());
  }, [client, root, reload]);

  // A list of another project (just switched) isn't shown while this one loads.
  return state.root === root ? { list: state.list, error: state.error, reload } : { list: null, error: null, reload };
}

/** One memory or instruction file's text, read when picked, and again whenever `version` changes (a new listing). */
export function useMemoryFile(root: string, path: string | null, version: unknown): { content: string | null; error: string | null } {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<{ path: string | null; content: string | null; error: string | null }>({ path: null, content: null, error: null });
  useEffect(() => {
    if (!client || !path) return;
    let cancelled = false;
    client.call('memory.read', { root, path }).then(
      ({ content }) => !cancelled && setState({ path, content, error: null }),
      (error: Error) => !cancelled && setState({ path, content: null, error: error.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [client, root, path, version]);
  return state.path === path ? { content: state.content, error: state.error } : { content: null, error: null };
}
