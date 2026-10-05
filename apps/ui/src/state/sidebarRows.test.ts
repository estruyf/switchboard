import { describe, expect, it } from 'vitest';
import type { LiveSession, SessionHostInfo } from '@switchboard/protocol/client';
import { toRows, useSessions, type SessionRowData } from './sessionsStore.ts';
import { buildSessionList, isActive, RECENT_MS, rowStatus } from './sidebarRows.ts';

const NOW = Date.UTC(2026, 9, 5, 12);
const HOUR = 3_600_000;

const row = (id: string, overrides: Partial<SessionRowData> = {}): SessionRowData => ({
  id,
  title: id,
  projectRoot: '/p/a',
  updatedAt: NOW - HOUR,
  branch: null,
  isWorktree: false,
  live: null,
  summary: null,
  pinned: false,
  settledAt: null,
  unread: false,
  error: false,
  ...overrides,
});

const live = (status: LiveSession['status']): LiveSession => ({
  sessionId: 'x',
  pid: 1,
  cwd: null,
  projectRoot: '/p/a',
  status,
  rawStatus: status,
  name: null,
  origin: 'cli',
  startedAt: null,
  updatedAt: null,
});

const old = NOW - RECENT_MS - HOUR;
const ids = (rows: SessionRowData[]) => rows.map((r) => r.id);

describe('rowStatus', () => {
  it('shows the most urgent state', () => {
    expect(rowStatus(row('a', { live: live('needs-you'), unread: true }))).toBe('needs-you');
    expect(rowStatus(row('a', { live: live('running') }))).toBe('running');
    expect(rowStatus(row('a', { error: true, unread: true }))).toBe('error');
    expect(rowStatus(row('a', { unread: true, live: live('idle') }))).toBe('unread');
    expect(rowStatus(row('a', { live: live('idle') }))).toBe('idle');
    expect(rowStatus(row('a'))).toBeNull();
  });
});

describe('isActive', () => {
  it('keeps recent, open, unread, pinned and failing sessions in the main list', () => {
    expect(isActive(row('a'), NOW)).toBe(true);
    expect(isActive(row('a', { updatedAt: old }), NOW)).toBe(false);
    expect(isActive(row('a', { updatedAt: old, unread: true }), NOW)).toBe(true);
    expect(isActive(row('a', { updatedAt: old, pinned: true }), NOW)).toBe(true);
    expect(isActive(row('a', { updatedAt: old, live: live('idle') }), NOW)).toBe(true);
    expect(isActive(row('a', { updatedAt: old, error: true }), NOW)).toBe(true);
  });

  it('honours settling by hand until there is new activity, but never hides work in progress', () => {
    expect(isActive(row('a', { settledAt: NOW - HOUR / 2 }), NOW)).toBe(false);
    expect(isActive(row('a', { settledAt: NOW - 2 * HOUR }), NOW)).toBe(true);
    expect(isActive(row('a', { settledAt: NOW, live: live('idle') }), NOW)).toBe(false);
    expect(isActive(row('a', { settledAt: NOW, live: live('needs-you') }), NOW)).toBe(true);
    // Settling a session that's working hides it until it finishes, despite its updates.
    expect(isActive(row('a', { settledAt: NOW - HOUR, updatedAt: NOW, live: live('running') }), NOW)).toBe(false);
    expect(isActive(row('a', { settledAt: NOW - HOUR, updatedAt: NOW, live: live('idle') }), NOW)).toBe(true);
  });
});

describe('buildSessionList', () => {
  const rows = [
    row('recent', { updatedAt: NOW - HOUR }),
    row('newest', { updatedAt: NOW - 60_000, projectRoot: '/p/b' }),
    row('pinned-old', { updatedAt: old, pinned: true }),
    row('old', { updatedAt: old, title: 'Fix login' }),
    row('older', { updatedAt: old - HOUR, projectRoot: '/p/b' }),
  ];

  it('puts pinned first, then newest, and the rest in Settled', () => {
    const list = buildSessionList(rows, { search: '', project: null, now: NOW });
    expect(ids(list.active)).toEqual(['pinned-old', 'newest', 'recent']);
    expect(ids(list.settled)).toEqual(['old', 'older']);
  });

  it('filters by project and by search', () => {
    expect(ids(buildSessionList(rows, { search: '', project: '/p/b', now: NOW }).active)).toEqual(['newest']);
    const found = buildSessionList(rows, { search: 'LOGIN', project: null, now: NOW });
    expect([...ids(found.active), ...ids(found.settled)]).toEqual(['old']);
  });
});

describe('toRows', () => {
  it('merges live state and adds rows for live sessions without a transcript yet', () => {
    const l = { ...live('running'), sessionId: 'new', cwd: '/p/a/sub', startedAt: 7 };
    expect(toRows(new Map(), new Map([['new', l]]))).toMatchObject([{ id: 'new', title: 'New session', projectRoot: '/p/a', updatedAt: 7, live: l }]);
  });

  it('prefers the state of sessions running in this app and flags failed runs', () => {
    const host: SessionHostInfo = { sessionId: 'mine', cwd: '/p/a/.claude/worktrees/wt', state: 'needs-you', model: null, permissionMode: 'default', effort: null, costUsd: 0, contextPercent: null, contextTokens: null, contextMax: null, error: null, startedAt: 5, queued: 0 };
    const closed: SessionHostInfo = { ...host, sessionId: 'old', state: 'closed' };
    const rows = toRows(new Map(), new Map(), new Map([['mine', host], ['old', closed]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'mine', projectRoot: '/p/a', live: { status: 'needs-you', origin: 'app' } });
  });
});

describe('panes', () => {
  const reset = () => useSessions.setState({ selectedId: null, mainId: null, splitId: null, activePane: 'main', view: 'session' });
  const state = () => {
    const s = useSessions.getState();
    return { main: s.mainId, split: s.splitId, active: s.activePane, selected: s.selectedId };
  };

  it('opens a session beside, selects into the active pane, and closes back to one', () => {
    reset();
    const s = useSessions.getState();
    s.select('a');
    expect(state()).toEqual({ main: 'a', split: null, active: 'main', selected: 'a' });
    s.openBeside('b');
    expect(state()).toEqual({ main: 'a', split: 'b', active: 'split', selected: 'b' });
    s.select('c');
    expect(state()).toEqual({ main: 'a', split: 'c', active: 'split', selected: 'c' });
    // Selecting what the other pane shows just focuses it.
    s.select('a');
    expect(state()).toEqual({ main: 'a', split: 'c', active: 'main', selected: 'a' });
    s.openBeside('d');
    expect(state()).toEqual({ main: 'a', split: 'd', active: 'split', selected: 'd' });
    s.closePane('main');
    expect(state()).toEqual({ main: 'd', split: null, active: 'main', selected: 'd' });
  });
});
