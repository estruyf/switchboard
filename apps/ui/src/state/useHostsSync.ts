import { useEffect } from 'react';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useHosts } from './hostsStore.ts';

/** Mirrors the engine's running sessions, permission prompts, live output, models and editors. */
export function useHostsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;

  useEffect(() => {
    if (!client) return;
    const store = () => useHosts.getState();
    const offs = [
      client.on('session.host', (info) => store().upsertHost(info)),
      client.on('session.stream', (delta) => store().applyStream(delta)),
      client.on('session.permission', (request) => store().addPermission(request)),
      client.on('session.permissionResolved', ({ requestId }) => store().removePermission(requestId)),
    ];
    void client.call('hosts.list', {}).then(({ hosts, permissions }) => store().reset(hosts, permissions));
    void client.call('models.list', {}).then(({ models }) => store().setModels(models));
    void client.call('editors.list', {}).then(({ editors, defaultId }) => store().setEditors(editors, defaultId));
    return () => offs.forEach((off) => off());
  }, [client]);
}
