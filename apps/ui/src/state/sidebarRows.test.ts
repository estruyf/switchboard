import { describe, expect, it } from 'vitest';
import type { LiveSession } from '@switchboard/protocol/client';
import { toRows, type SessionRowData } from './sessionsStore.ts';
import { buildSidebarRows, type SidebarRow } from './sidebarRows.ts';

const row = (id: string, root: string, updatedAt: number, title = id): SessionRowData => ({
  id,
  title,
  projectRoot: root,
  updatedAt,
  branch: null,
  isWorktree: false,
  live: null,
  summary: null,
});

const shape = (rows: SidebarRow[]) =>
  rows.map((r) => (r.kind === 'project' ? `[${r.name}]` : r.kind === 'session' ? r.data.id : `+${r.hidden}`));

const base = { filter: '', collapsed: new Set<string>(), expanded: new Set<string>(), selectedId: null };

describe('buildSidebarRows', () => {
  it('orders projects by latest activity and sessions newest first', () => {
    const rows = buildSidebarRows([row('a1', '/p/a', 1), row('b1', '/p/b', 5), row('a2', '/p/a', 9)], base);
    expect(shape(rows)).toEqual(['[a]', 'a2', 'a1', '[b]', 'b1']);
  });

  it('caps each project and keeps the selected session visible', () => {
    const sessions = [1, 2, 3, 4].map((n) => row(`s${n}`, '/p/a', n));
    expect(shape(buildSidebarRows(sessions, { ...base, perProject: 2 }))).toEqual(['[a]', 's4', 's3', '+2']);
    expect(shape(buildSidebarRows(sessions, { ...base, perProject: 2, selectedId: 's1' }))).toEqual(['[a]', 's4', 's3', 's1', '+1']);
    expect(shape(buildSidebarRows(sessions, { ...base, perProject: 2, expanded: new Set(['/p/a']) }))).toEqual(['[a]', 's4', 's3', 's2', 's1', '+2']);
  });

  it('shows the most urgent live status on the project row', () => {
    const live = (status: LiveSession['status']): LiveSession => ({ sessionId: status, pid: 1, cwd: null, projectRoot: '/p/a', status, rawStatus: status, name: null, origin: 'cli', startedAt: null, updatedAt: null });
    const rows = buildSidebarRows([{ ...row('a', '/p/a', 1), live: live('idle') }, { ...row('b', '/p/a', 2), live: live('needs-you') }, { ...row('c', '/p/a', 3), live: live('running') }], base);
    expect(rows[0]).toMatchObject({ kind: 'project', liveCount: 3, liveStatus: 'needs-you' });
    expect(buildSidebarRows([row('d', '/p/b', 1)], base)[0]).toMatchObject({ liveStatus: null });
  });

  it('hides sessions of collapsed projects', () => {
    expect(shape(buildSidebarRows([row('a1', '/p/a', 1)], { ...base, collapsed: new Set(['/p/a']) }))).toEqual(['[a]']);
  });

  it('filters on title, folder and branch, showing every match', () => {
    const sessions = [row('x', '/p/web', 1, 'Fix login'), row('y', '/p/api', 2, 'Add cache'), { ...row('z', '/p/api', 3, 'Misc'), branch: 'feature/login' }];
    expect(shape(buildSidebarRows(sessions, { ...base, filter: 'LOGIN', collapsed: new Set(['/p/web']) }))).toEqual(['[api]', 'z', '[web]', 'x']);
    expect(shape(buildSidebarRows(sessions, { ...base, filter: 'web' }))).toEqual(['[web]', 'x']);
  });
});

describe('toRows', () => {
  it('merges live state and adds rows for live sessions without a transcript yet', () => {
    const live: LiveSession = { sessionId: 'new', pid: 1, cwd: '/p/a/sub', projectRoot: '/p/a', status: 'running', rawStatus: 'busy', name: null, origin: 'cli', startedAt: 7, updatedAt: null };
    const rows = toRows(new Map(), new Map([['new', live]]));
    expect(rows).toMatchObject([{ id: 'new', title: 'New session', projectRoot: '/p/a', updatedAt: 7, live }]);
  });
});
