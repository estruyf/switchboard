import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionsChanged, TranscriptMessage, TranscriptUpdate } from '@switchboard/protocol';
import { createProjectResolver } from '../claude/projectResolver.ts';
import type { RawSessionInfo, SessionSource } from '../claude/sessionSource.ts';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { openCacheDatabase } from '../db/database.ts';
import { coalesce } from '../util/coalesce.ts';
import { SessionIndex } from './sessionIndex.ts';
import { diffTranscript, TranscriptHub } from './transcriptHub.ts';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-sessions-')));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const until = async (check: () => boolean, timeoutMs = 3000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

function fakeSource(initial: RawSessionInfo[]) {
  const infos = new Map(initial.map((i) => [i.sessionId, i]));
  const messages = new Map<string, RawSessionMessage[]>();
  const source: SessionSource = {
    list: async () => [...infos.values()],
    info: async (id) => infos.get(id),
    messages: async (id) => messages.get(id) ?? [],
  };
  return { source, infos, messages };
}

function setup(infos: RawSessionInfo[], db = openCacheDatabase(join(tempDir(), 'cache.sqlite'))) {
  const projectsDir = join(tempDir(), 'projects');
  mkdirSync(join(projectsDir, '-repo'), { recursive: true });
  const fake = fakeSource(infos);
  const changes: SessionsChanged[] = [];
  const transcriptChanges: string[] = [];
  const index = new SessionIndex({
    db: db.db,
    source: fake.source,
    projectsDir,
    resolver: createProjectResolver('/nonexistent-home'),
    log: () => {},
    onChange: (c) => changes.push(c),
    onTranscriptChanged: (id) => transcriptChanges.push(id),
  });
  cleanups.push(() => index.stop());
  return { index, changes, transcriptChanges, projectsDir, db, ...fake };
}

const info = (id: string, extra: Partial<RawSessionInfo> = {}): RawSessionInfo => ({
  sessionId: id,
  summary: `Session ${id.slice(0, 4)}`,
  lastModified: 1000,
  cwd: '/work/app',
  ...extra,
});

describe('SessionIndex', () => {
  it('reconciles with the source and emits one delta', async () => {
    const { index, changes, projectsDir } = setup([info(ID_A, { customTitle: '  Custom\n title ' }), info(ID_B, { lastModified: 2000 })]);
    writeFileSync(join(projectsDir, '-repo', `${ID_A}.jsonl`), '{"entrypoint":"cli"}\n');
    expect(index.snapshot()).toEqual({ sessions: [], complete: false });
    await index.refresh();
    expect(changes).toHaveLength(1);
    expect(changes[0]!.complete).toBe(true);
    const { sessions } = index.snapshot();
    expect(sessions.map((s) => s.id)).toEqual([ID_B, ID_A]);
    expect(sessions[1]).toMatchObject({ title: 'Custom title', origin: 'cli', projectRoot: '/work/app' });
    expect(sessions[0]!.origin).toBe('unknown');
  });

  it('only emits what changed on later refreshes', async () => {
    const { index, changes, infos } = setup([info(ID_A), info(ID_B)]);
    await index.refresh();
    infos.set(ID_A, info(ID_A, { summary: 'Renamed', lastModified: 5000 }));
    infos.delete(ID_B);
    await index.refresh();
    expect(changes[1]).toMatchObject({ removed: [ID_B], upserted: [{ id: ID_A, title: 'Renamed' }] });
    await index.refresh();
    expect(changes).toHaveLength(2);
  });

  it('serves the cached list immediately on the next start', async () => {
    const db = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    const first = setup([info(ID_A)], db);
    await first.index.refresh();
    first.index.stop();
    const second = setup([], db);
    expect(second.index.snapshot()).toMatchObject({ complete: false, sessions: [{ id: ID_A }] });
  });

  it('follows transcript writes and deletions through the file watcher', async () => {
    const { index, changes, transcriptChanges, projectsDir, infos } = setup([]);
    index.start();
    await until(() => changes.length === 1);
    infos.set(ID_A, info(ID_A, { summary: 'New one' }));
    const file = join(projectsDir, '-repo', `${ID_A}.jsonl`);
    writeFileSync(file, '{"entrypoint":"cli"}\n');
    await until(() => index.snapshot().sessions.length === 1);
    expect(index.snapshot().sessions[0]).toMatchObject({ title: 'New one', origin: 'cli' });
    expect(transcriptChanges).toContain(ID_A);
    unlinkSync(file);
    await until(() => index.snapshot().sessions.length === 0);
    expect(changes.at(-1)?.removed).toEqual([ID_A]);
  });
});

const msg = (uuid: string, text = uuid): RawSessionMessage => ({ type: 'user', uuid, parent_tool_use_id: null, message: { content: text } });
const uuids = (messages: TranscriptMessage[]) => messages.map((m) => m.uuid);

describe('diffTranscript', () => {
  const t = (...ids: string[]) => ids.map((uuid) => ({ uuid }) as TranscriptMessage);
  it('appends, ignores no-ops and replaces when history changed', () => {
    expect(diffTranscript(['a'], t('a', 'b'))).toEqual({ mode: 'append', messages: t('b') });
    expect(diffTranscript(['a', 'b'], t('a', 'b'))).toBeNull();
    expect(diffTranscript(['a', 'b'], t('a', 'c'))).toEqual({ mode: 'replace', messages: t('a', 'c') });
    expect(diffTranscript(['a', 'b'], t('a'))).toEqual({ mode: 'replace', messages: t('a') });
  });
});

describe('TranscriptHub', () => {
  it('sends a full load, then appends, then replaces after a rewind', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [msg('1'), msg('2')]);
    const hub = new TranscriptHub(source, () => {});
    const updates: TranscriptUpdate[] = [];
    const stop = hub.watch(ID_A, (u) => updates.push(u));
    await until(() => updates.length === 1);
    expect(updates[0]).toMatchObject({ mode: 'replace' });
    expect(uuids(updates[0]!.messages)).toEqual(['1', '2']);

    messages.set(ID_A, [msg('1'), msg('2'), msg('3')]);
    hub.changed(ID_A);
    await until(() => updates.length === 2);
    expect(updates[1]!.mode).toBe('append');
    expect(uuids(updates[1]!.messages)).toEqual(['3']);

    messages.set(ID_A, [msg('1'), msg('x')]);
    hub.changed(ID_A);
    await until(() => updates.length === 3);
    expect(updates[2]!.mode).toBe('replace');
    stop();
    hub.stop();
  });

  it('never sends duplicates when a change lands during the initial load', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [msg('1')]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: SessionSource = { ...source, messages: async (id) => (await gate, source.messages(id)) };
    const hub = new TranscriptHub(slow, () => {});
    const updates: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => updates.push(u));
    messages.set(ID_A, [msg('1'), msg('2')]);
    hub.changed(ID_A);
    await new Promise((r) => setTimeout(r, 150));
    release();
    await until(() => updates.length >= 1);
    await new Promise((r) => setTimeout(r, 250));
    const delivered = updates.reduce<string[]>((acc, u) => (u.mode === 'replace' ? uuids(u.messages) : [...acc, ...uuids(u.messages)]), []);
    expect(delivered).toEqual(['1', '2']);
    hub.stop();
  });
});

describe('coalesce', () => {
  it('runs at most once per interval and once more after a busy run', async () => {
    vi.useFakeTimers();
    let runs = 0;
    const c = coalesce(() => {
      runs++;
    }, 100);
    c.trigger();
    c.trigger();
    c.trigger();
    await vi.advanceTimersByTimeAsync(100);
    expect(runs).toBe(1);
    c.trigger();
    await vi.advanceTimersByTimeAsync(100);
    expect(runs).toBe(2);
    c.stop();
    vi.useRealTimers();
  });
});
