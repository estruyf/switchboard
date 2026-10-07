import { describe, expect, it } from 'vitest';
import type { LiveSession } from '@switchboard/protocol/client';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { matchProjects, matchSessions, orderSessions } from './gotoItems.ts';

const row = (id: string, updatedAt: number, over: Partial<SessionRowData> = {}): SessionRowData => ({
  id,
  title: id,
  projectRoot: '/work/app',
  updatedAt,
  branch: null,
  isWorktree: false,
  live: null,
  summary: null,
  pinned: false,
  archivedAt: null,
  unread: false,
  inApp: true,
  error: false,
  profileId: 'default',
  ...over,
});
const live = (status: LiveSession['status']) => ({ status }) as LiveSession;

describe('orderSessions', () => {
  it('lists needs you, then working, then unread, then the most recent', () => {
    const rows = [row('old', 1), row('recent', 50), row('unread', 5, { unread: true }), row('working', 2, { live: live('running') }), row('asking', 3, { live: live('needs-you') })];
    expect(orderSessions(rows).map((r) => r.id)).toEqual(['asking', 'working', 'unread', 'recent', 'old']);
  });
});

describe('matchSessions', () => {
  const rows = [row('Fix the login', 10), row('Release notes', 20, { projectRoot: '/work/site' }), row('Flaky tests', 5, { live: live('needs-you') })];
  const name = (root: string) => root.split('/').pop()!;

  it('keeps the order and a limit with nothing typed', () => {
    expect(matchSessions(rows, '', name, 2).map((m) => m.item.id)).toEqual(['Flaky tests', 'Release notes']);
  });

  it('matches titles (highlighted) and project names', () => {
    const [first] = matchSessions(rows, 'login', name, 10);
    expect(first!.item.id).toBe('Fix the login');
    expect(first!.indices).toEqual([8, 9, 10, 11, 12]);
    expect(matchSessions(rows, 'site', name, 10).map((m) => m.item.id)).toEqual(['Release notes']);
  });
});

describe('matchProjects', () => {
  it('matches by name, then by path', () => {
    const roots = ['/work/switchboard', '/work/demo-time', '/archive/tideline'];
    const name = (root: string) => root.split('/').pop()!;
    expect(matchProjects(roots, '', name).map((m) => m.item)).toEqual(roots);
    expect(matchProjects(roots, 'demo', name)[0]!.item).toBe('/work/demo-time');
    expect(matchProjects(roots, 'archive', name).map((m) => m.item)).toEqual(['/archive/tideline']);
  });
});
