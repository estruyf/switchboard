import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COMPANION_DIR,
  COMPANION_INFO_FILE,
  COMPANION_PROTOCOL,
  createRpcClient,
  lineTransport,
  messagePortTransport,
  type CompanionContract,
  type CompanionInfo,
  type Contract,
  type DomLikePort,
  type RpcClient,
} from '@switchboard/protocol';
import type { SessionSource } from '../claude/sessionSource.ts';
import { createEngine } from '../engine.ts';
import { inFolders, isWithin, sessionsFor } from './companionSessions.ts';

const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const source: SessionSource = {
  list: async () => [{ sessionId: SESSION_ID, summary: 'Fix the login form', lastModified: 42, cwd: '/work/web' }],
  info: async () => undefined,
  messages: async () => [],
};

const asDomPort = (port: MessagePort) => port as unknown as DomLikePort;
const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

async function until<T>(read: () => T | Promise<T>, ok: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** An engine listening for the companion, and a window attached to it. */
async function start() {
  const dataDir = mkdtempSync(join(tmpdir(), 'switchboard-companion-'));
  const engine = createEngine({
    dataDir,
    claudeConfigDir: join(dataDir, 'claude'),
    shellEnv: Promise.resolve({ shell: '/bin/zsh', env: { PATH: '' }, resolved: false, durationMs: 0 }),
    claudeBinary: '/nonexistent/claude',
    sessionSource: source,
    companion: { appVersion: '9.9.9' },
  });
  const { port1, port2 } = new MessageChannel();
  const detach = engine.attach(messagePortTransport(asDomPort(port1)));
  const window = createRpcClient<Contract>(messagePortTransport(asDomPort(port2)));
  cleanups.push(() => {
    window.dispose();
    detach();
    engine.close();
    port1.close();
    port2.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  const infoFile = join(dataDir, COMPANION_DIR, COMPANION_INFO_FILE);
  await until(() => existsSync(infoFile), Boolean);
  const info = JSON.parse(readFileSync(infoFile, 'utf8')) as CompanionInfo;
  await until(() => window.call('sessions.list', {}), (s) => s.sessions.some((x) => x.id === SESSION_ID));
  return { dataDir, window, info, infoFile };
}

/** An editor's connection to the socket. */
function editor(info: CompanionInfo): { client: RpcClient<CompanionContract>; socket: Socket; closed: Promise<void> } {
  const socket = createConnection(info.socket);
  socket.setEncoding('utf8');
  const transport = lineTransport({
    write: (text) => void socket.write(text),
    onData(listener) {
      socket.on('data', listener);
      return () => socket.off('data', listener);
    },
    close: () => socket.destroy(),
  });
  const client = createRpcClient<CompanionContract>(transport, { timeoutMs: 3_000 });
  const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
  cleanups.push(() => {
    client.dispose();
    socket.destroy();
  });
  return { client, socket, closed };
}

const hello = (client: RpcClient<CompanionContract>, token: string) => client.call('hello', { token, protocol: COMPANION_PROTOCOL, client: { name: 'test', version: '0' } });

describe('companion socket', () => {
  it('writes where it listens to a file only you can read', async () => {
    const { info, infoFile } = await start();
    expect(statSync(infoFile).mode & 0o777).toBe(0o600);
    expect(statSync(join(infoFile, '..')).mode & 0o777).toBe(0o700);
    expect(statSync(join(info.socket, '..')).mode & 0o777).toBe(0o700);
    expect(info).toMatchObject({ protocol: COMPANION_PROTOCOL, appVersion: '9.9.9', pid: process.pid });
    expect(info.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a wrong token and closes the connection', async () => {
    const { info } = await start();
    const { client, closed } = editor(info);
    await expect(hello(client, 'not-the-token')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await closed;
  });

  it('refuses anything before hello', async () => {
    const { info } = await start();
    const { client, closed } = editor(info);
    await expect(client.call('sessions.list', { folders: [] })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await closed;
  });

  it('validates what an editor sends', async () => {
    const { info } = await start();
    const { client } = editor(info);
    await hello(client, info.token);
    await expect(client.call('context.add', { target: { kind: 'new', cwd: 'relative/path' }, items: [] })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('lists the sessions of the workspace folders, and the one on screen', async () => {
    const { info, window } = await start();
    const { client } = editor(info);
    await expect(hello(client, info.token)).resolves.toMatchObject({ protocol: COMPANION_PROTOCOL, app: { version: '9.9.9' } });
    expect((await client.call('sessions.list', { folders: ['/work'] })).sessions.map((s) => s.id)).toEqual([SESSION_ID]);
    expect((await client.call('sessions.list', { folders: ['/work/web/src'] })).sessions.map((s) => s.id)).toEqual([SESSION_ID]);
    expect((await client.call('sessions.list', { folders: ['/elsewhere'] })).sessions).toEqual([]);
    expect((await client.call('sessions.list', { folders: [] })).focused).toBeNull();
    await window.call('companion.focus', { sessionId: SESSION_ID });
    const listed = await client.call('sessions.list', { folders: ['/elsewhere'] });
    expect(listed.focused).toMatchObject({ id: SESSION_ID, cwd: '/work/web', status: 'stopped' });
    expect(listed.windows).toBe(1);
  });

  it('hands context to the window that reported focus, and waits for it to be added', async () => {
    const { info, window } = await start();
    const { client } = editor(info);
    await hello(client, info.token);
    const items = [{ kind: 'file' as const, path: '/work/web/src/login.ts', range: { start: 12, end: 40 } }];
    // No window has said what it shows yet: nowhere to put it.
    await expect(client.call('context.add', { target: { kind: 'session', sessionId: SESSION_ID }, items })).rejects.toMatchObject({ code: 'NO_WINDOW' });

    await window.call('companion.focus', { sessionId: null });
    const received: unknown[] = [];
    window.on('companion.context', (event) => {
      received.push(event);
      void window.call('companion.received', { deliveryId: event.deliveryId });
    });
    await client.call('context.add', { target: { kind: 'session', sessionId: SESSION_ID }, items, reveal: false });
    expect(received).toEqual([{ deliveryId: expect.any(String), target: { kind: 'session', sessionId: SESSION_ID }, items: [{ ...items[0], directory: false }], reveal: false }]);

    await expect(client.call('context.add', { target: { kind: 'session', sessionId: 'no-such-session' }, items })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports a window that could not add the context', async () => {
    const { info, window, dataDir } = await start();
    const { client } = editor(info);
    await hello(client, info.token);
    await window.call('companion.focus', { sessionId: null });
    window.on('companion.context', (event) => void window.call('companion.received', { deliveryId: event.deliveryId, error: 'No room' }));
    await expect(client.call('context.add', { target: { kind: 'new', cwd: dataDir }, items: [{ kind: 'text', source: 'terminal', label: 'Terminal', text: 'npm ERR!' }] })).rejects.toMatchObject({
      code: 'NOT_ADDED',
      message: 'No room',
    });
  });

  it('tells watching editors when the session on screen changes', async () => {
    const { info, window } = await start();
    const { client } = editor(info);
    await hello(client, info.token);
    const changes: Array<string | null> = [];
    client.on('sessions.changed', ({ focused }) => void changes.push(focused?.id ?? null));
    await client.call('sessions.watch', { folders: ['/work'] });
    await window.call('companion.focus', { sessionId: SESSION_ID });
    await until(() => changes, (c) => c.length > 0);
    expect(changes).toEqual([SESSION_ID]);
  });
});

describe('session matching', () => {
  const session = (cwd: string | null, projectRoot = cwd ?? '/repo') => ({ cwd, projectRoot });

  it('matches folders by path, not by prefix', () => {
    expect(isWithin('/repo/src', '/repo')).toBe(true);
    expect(isWithin('/repo', '/repo/')).toBe(true);
    expect(isWithin('/repository', '/repo')).toBe(false);
  });

  it('lists a session when it works in a workspace folder, or a workspace folder is inside its own', () => {
    expect(inFolders(session('/repo/.claude/worktrees/fix'), ['/repo'])).toBe(true);
    expect(inFolders(session('/repo'), ['/repo/packages/web'])).toBe(true);
    expect(inFolders(session('/repo/packages/api'), ['/repo/packages/web'])).toBe(false);
    expect(inFolders(session(null, '/repo'), ['/repo'])).toBe(true);
    expect(inFolders(session('/other'), [])).toBe(true);
  });

  it('puts what needs you first, then what is working, then the most recent', () => {
    const base = { title: '', cwd: '/repo', projectRoot: '/repo', branch: null, inApp: true };
    const list = sessionsFor(
      [
        { ...base, id: 'old', status: 'idle', updatedAt: 1 },
        { ...base, id: 'new', status: 'stopped', updatedAt: 9 },
        { ...base, id: 'busy', status: 'working', updatedAt: 2 },
        { ...base, id: 'ask', status: 'needs-you', updatedAt: 3 },
      ],
      ['/repo'],
    );
    expect(list.map((s) => s.id)).toEqual(['ask', 'busy', 'old', 'new']);
  });
});
