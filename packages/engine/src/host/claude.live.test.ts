/**
 * End-to-end against the real Claude Code CLI (costs a few cents of Haiku).
 * Opt-in: SWITCHBOARD_LIVE_CWD=/path/to/throwaway/git/repo npx vitest run claude.live
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createRpcClient,
  messagePortTransport,
  type Contract,
  type DomLikePort,
  type PermissionRequest,
  type SessionHostInfo,
  type StreamDelta,
  type TranscriptMessage,
} from '@switchboard/protocol';
import { createEngine } from '../engine.ts';

const cwd = process.env.SWITCHBOARD_LIVE_CWD;
const asDomPort = (port: MessagePort) => port as unknown as DomLikePort;

const until = async (what: string, check: () => boolean, timeoutMs = 90_000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

const texts = (messages: TranscriptMessage[]) =>
  messages.flatMap((m) => m.blocks.flatMap((b) => (b.type === 'text' ? [`${m.role}:${b.text.trim()}`] : [])));

describe.skipIf(!cwd)('live Claude Code session', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'switchboard-live-'));
  const engine = createEngine({ dataDir, onLog: (e) => e.level !== 'debug' && console.log(`[engine] ${e.level}: ${e.message}`) });
  const { port1, port2 } = new MessageChannel();
  engine.attach(messagePortTransport(asDomPort(port1)));
  const client = createRpcClient<Contract>(messagePortTransport(asDomPort(port2)), { timeoutMs: 120_000 });

  const hosts: SessionHostInfo[] = [];
  const streams: StreamDelta[] = [];
  const permissions: PermissionRequest[] = [];
  let transcript: TranscriptMessage[] = [];
  client.on('session.host', (h) => hosts.push(h));
  client.on('session.stream', (d) => streams.push(d));
  client.on('session.permission', (p) => permissions.push(p));
  client.on('transcript.updated', (u) => (transcript = u.mode === 'replace' ? u.messages : [...transcript, ...u.messages]));
  const state = (id: string) => hosts.filter((h) => h.sessionId === id).at(-1)?.state;

  afterAll(() => {
    client.dispose();
    engine.close();
    port1.close();
    port2.close();
    rmSync(dataDir, { recursive: true, force: true });
    if (cwd) rmSync(join(cwd, 'live-e2e.txt'), { force: true });
  });

  it('creates, asks permission, streams, continues, resumes and interrupts', async () => {
    const started = Date.now();
    const { sessionId } = await client.call('session.create', {
      cwd: cwd!,
      model: 'haiku',
      permissionMode: 'default',
      prompt: 'Run exactly this with the Bash tool: touch live-e2e.txt — then reply with exactly the word CREATED.',
    });
    await client.call('transcript.watch', { sessionId });

    // 1. A real permission prompt arrives and approving it lets the tool run.
    await until('permission prompt', () => permissions.some((p) => p.sessionId === sessionId));
    const request = permissions.find((p) => p.sessionId === sessionId)!;
    console.log(`permission prompt after ${Date.now() - started}ms:`, request.toolName, JSON.stringify(request.input), '| always:', request.alwaysLabel);
    expect(request.toolName).toBe('Bash');
    await client.call('session.respond', { requestId: request.requestId, decision: { behavior: 'allow' } });
    await until('first turn done', () => state(sessionId) === 'idle' && texts(transcript).some((t) => t.includes('CREATED')));
    expect(existsSync(join(cwd!, 'live-e2e.txt'))).toBe(true);
    expect(streams.some((s) => s.sessionId === sessionId && s.kind === 'text')).toBe(true);
    console.log(`first turn done after ${Date.now() - started}ms; ${streams.length} stream updates`);

    // 2. A follow-up on the same process.
    await client.call('session.send', { sessionId, text: 'Reply with exactly the word SECOND.' });
    await until('second reply', () => texts(transcript).some((t) => t.includes('SECOND') && t.startsWith('assistant')));
    await until('idle after second', () => state(sessionId) === 'idle');

    // 3. Stop the process, then resume by sending again.
    await client.call('session.close', { sessionId });
    expect(state(sessionId)).toBe('closed');
    await client.call('session.send', { sessionId, text: 'Reply with exactly the word RESUMED.' });
    await until('resumed reply', () => texts(transcript).some((t) => t.includes('RESUMED') && t.startsWith('assistant')));
    await until('idle after resume', () => state(sessionId) === 'idle');

    // 4. Interrupt a long answer; the session stays usable.
    const before = streams.length;
    await client.call('session.send', { sessionId, text: 'Write the numbers from 1 to 400, one per line, no other text.' });
    await until('streaming numbers', () => streams.length > before + 3);
    await client.call('session.interrupt', { sessionId });
    await until('idle after interrupt', () => state(sessionId) === 'idle', 30_000);
    await client.call('session.send', { sessionId, text: 'Reply with exactly the word AFTER.' });
    await until('reply after interrupt', () => texts(transcript).some((t) => t.includes('AFTER') && t.startsWith('assistant')));

    // 5. The transcript has no duplicates, even though messages arrived both live and from the file.
    const uuids = transcript.map((m) => m.uuid);
    expect(new Set(uuids).size).toBe(uuids.length);

    // 6. The index picks it up as a Switchboard session.
    const listed = async () => (await client.call('sessions.list', {})).sessions.find((s) => s.id === sessionId);
    const deadline = Date.now() + 15_000;
    let summary = await listed();
    while (!summary && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      summary = await listed();
    }
    expect(summary?.origin).toBe('app');
    console.log(`all steps done in ${Date.now() - started}ms; cost $${hosts.filter((h) => h.sessionId === sessionId).at(-1)?.costUsd}`);
  }, 300_000);
});
