import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { createRpcClient, messagePortTransport, type Contract, type DomLikePort, type LogEntry, type TranscriptUpdate } from '@switchboard/protocol';
import type { SessionSource } from './claude/sessionSource.ts';
import { createEngine } from './engine.ts';

const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const fakeSource: SessionSource = {
  list: async () => [{ sessionId: SESSION_ID, summary: 'Refactor parser', lastModified: 42, cwd: '/work/parser' }],
  info: async () => undefined,
  messages: async () => [
    { type: 'user', uuid: 'u1', parent_tool_use_id: null, message: { content: 'Refactor the parser' } },
    { type: 'assistant', uuid: 'a1', parent_tool_use_id: null, message: { model: 'm', content: [{ type: 'text', text: 'Done.' }] } },
  ],
};

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
    sessionSource: fakeSource,
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
    expect(seen.filter((e) => e.level === 'info').map((e) => e.message)).toEqual(['hello']);
  });

  it('lists sessions once the first scan completes', async () => {
    const { client } = connect();
    const changed = new Promise((resolve) => client.on('sessions.changed', resolve));
    await changed;
    const snapshot = await client.call('sessions.list', {});
    expect(snapshot.complete).toBe(true);
    expect(snapshot.sessions).toMatchObject([{ id: SESSION_ID, title: 'Refactor parser', projectRoot: '/work/parser' }]);
    expect(snapshot.live).toEqual([]);
  });

  it('streams a watched transcript to the caller', async () => {
    const { client } = connect();
    const update = new Promise<TranscriptUpdate>((resolve) => client.on('transcript.updated', resolve));
    await client.call('transcript.watch', { sessionId: SESSION_ID });
    const first = await update;
    expect(first.mode).toBe('replace');
    expect(first.messages.map((m) => m.blocks[0])).toEqual([
      { type: 'text', text: 'Refactor the parser' },
      { type: 'text', text: 'Done.' },
    ]);
    await client.call('transcript.unwatch', { sessionId: SESSION_ID });
  });
});
