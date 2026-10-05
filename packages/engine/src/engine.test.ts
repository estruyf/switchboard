import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { createRpcClient, messagePortTransport, type Contract, type DomLikePort, type LogEntry } from '@switchboard/protocol';
import { createEngine } from './engine.ts';

// Node's MessagePort is a DOM-style EventTarget at runtime; its typings just use a generic Event.
const asDomPort = (port: MessagePort) => port as unknown as DomLikePort;

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function connect() {
  const dataDir = mkdtempSync(join(tmpdir(), 'switchboard-engine-'));
  const engine = createEngine({
    dataDir,
    claudeConfigDir: join(dataDir, 'claude'),
    // No login shell and an empty PATH, so the test never depends on the machine.
    shellEnv: Promise.resolve({ shell: '/bin/zsh', env: { PATH: '' }, resolved: false, durationMs: 0 }),
    claudeBinary: '/nonexistent/claude',
  });
  const { port1, port2 } = new MessageChannel();
  const detach = engine.attach(messagePortTransport(asDomPort(port1)));
  const client = createRpcClient<Contract>(messagePortTransport(asDomPort(port2)));
  cleanups.push(() => {
    client.dispose();
    detach();
    engine.close();
    port1.close();
    port2.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { engine, client, dataDir };
}

describe('engine over a MessagePort', () => {
  it('answers ping', async () => {
    const { client } = connect();
    const sentAt = Date.now();
    const pong = await client.call('system.ping', { sentAt });
    expect(pong.sentAt).toBe(sentAt);
    expect(pong.engineTime).toBeGreaterThanOrEqual(sentAt);
  });

  it('reports system info', async () => {
    const { client, dataDir } = connect();
    const info = await client.call('system.info', {});
    expect(info.paths.database).toBe(join(dataDir, 'cache.sqlite'));
    expect(info.versions.sqlite).toMatch(/^\d+\.\d+/);
    expect(info.shell.resolved).toBe(false);
    expect(info.claude).toBeNull();
  });

  it('persists app state', async () => {
    const { client } = connect();
    await client.call('appState.set', { key: 'ui.sidebarWidth', value: 280 });
    await expect(client.call('appState.get', { key: 'ui.sidebarWidth' })).resolves.toEqual({ value: 280 });
  });

  it('pushes log events to attached clients', async () => {
    const { client, engine } = connect();
    const seen: LogEntry[] = [];
    client.on('engine.log', (entry) => seen.push(entry));
    engine.log('info', 'hello');
    await client.call('system.ping', { sentAt: 0 });
    expect(seen.map((e) => e.message)).toEqual(['hello']);
  });
});
