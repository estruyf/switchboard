import { describe, expect, it } from 'vitest';
import type { LaterItem, LiveSession, SessionHostInfo } from '@switchboard/protocol/client';
import { toRows, useSessions, type SessionRowData } from './sessionsStore.ts';
import { archivesOnMiddleClick, buildListRows, buildSessionList, groupSessions, inScope, isActive, laterInList, RECENT_MS, rowStatus, sessionGroup, sessionsByHeader, startOfDay, startupSession, waitingLabel } from './sidebarRows.ts';

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
  archivedAt: null,
  unread: false,
  inApp: false,
  error: false,
  profileId: 'default',
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
  profileId: 'default',
});

const old = NOW - RECENT_MS - HOUR;
const ids = (rows: SessionRowData[]) => rows.map((r) => r.id);

describe('rowStatus', () => {
  it('shows the most urgent state', () => {
    expect(rowStatus(row('a', { live: live('needs-you'), unread: true }))).toBe('needs-you');
    expect(rowStatus(row('a', { live: live('running') }))).toBe('running');
    expect(rowStatus(row('a', { error: true, unread: true }))).toBe('error');
    expect(rowStatus(row('a', { unread: true, live: live('idle') }))).toBe('unread');
    expect(rowStatus(row('a', { live: { ...live('idle'), background: ['npm run test:links'] } }))).toBe('background');
    expect(rowStatus(row('a', { live: { ...live('idle'), background: [] } }))).toBe('idle');
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
    expect(isActive(row('a', { updatedAt: old, live: { ...live('idle'), origin: 'app' } }), NOW)).toBe(true);
    // Idle in another Claude Code window (e.g. Claude desktop reopening it at launch) isn't news.
    expect(isActive(row('a', { updatedAt: old, live: live('idle') }), NOW)).toBe(false);
    expect(isActive(row('a', { updatedAt: old, error: true }), NOW)).toBe(true);
  });

  it('honours archiving by hand until there is new activity, but never hides work in progress', () => {
    expect(isActive(row('a', { archivedAt: NOW - HOUR / 2 }), NOW)).toBe(false);
    expect(isActive(row('a', { archivedAt: NOW - 2 * HOUR }), NOW)).toBe(true);
    expect(isActive(row('a', { archivedAt: NOW, live: live('idle') }), NOW)).toBe(false);
    expect(isActive(row('a', { archivedAt: NOW, live: live('needs-you') }), NOW)).toBe(true);
    // Archiving a session that's working hides it until it finishes, despite its updates.
    expect(isActive(row('a', { archivedAt: NOW - HOUR, updatedAt: NOW, live: live('running') }), NOW)).toBe(false);
    expect(isActive(row('a', { archivedAt: NOW - HOUR, updatedAt: NOW, live: live('idle') }), NOW)).toBe(true);
  });

});

describe('archivesOnMiddleClick', () => {
  // Only indexed sessions have flags; the summary's fields don't matter here.
  const indexed = (id: string, overrides: Partial<SessionRowData> = {}) => row(id, { summary: { id } as SessionRowData['summary'], ...overrides });

  it('archives finished sessions in the main list only', () => {
    expect(archivesOnMiddleClick(indexed('a'), NOW)).toBe(true);
    expect(archivesOnMiddleClick(indexed('a', { unread: true }), NOW)).toBe(true);
    expect(archivesOnMiddleClick(indexed('a', { live: live('idle') }), NOW)).toBe(true);
    expect(archivesOnMiddleClick(indexed('a', { pinned: true }), NOW)).toBe(true);
    expect(archivesOnMiddleClick(indexed('a', { live: live('running') }), NOW)).toBe(false);
    expect(archivesOnMiddleClick(indexed('a', { live: live('needs-you') }), NOW)).toBe(false);
    expect(archivesOnMiddleClick(indexed('a', { live: { ...live('idle'), background: ['npm run dev'] } }), NOW)).toBe(false);
    expect(archivesOnMiddleClick(indexed('a', { error: true }), NOW)).toBe(false);
    expect(archivesOnMiddleClick(indexed('a', { archivedAt: NOW }), NOW)).toBe(false);
    expect(archivesOnMiddleClick(row('a'), NOW)).toBe(false);
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

  it('puts pinned first, then newest, and the rest in Archived', () => {
    const list = buildSessionList(rows, { search: '', project: null, now: NOW });
    expect(ids(list.active)).toEqual(['pinned-old', 'newest', 'recent']);
    expect(ids(list.archived)).toEqual(['old', 'older']);
  });

  it('lists sessions archived by hand with the quiet ones, newest first', () => {
    const list = buildSessionList([...rows, row('gone-recent', { archivedAt: NOW })], { search: '', project: null, now: NOW });
    expect(ids(list.active)).toEqual(['pinned-old', 'newest', 'recent']);
    expect(ids(list.archived)).toEqual(['gone-recent', 'old', 'older']);
  });

  it('lists only Switchboard sessions in that scope', () => {
    const mixed = [row('mine', { inApp: true }), row('cli')];
    expect(ids(buildSessionList(mixed, { search: '', project: null, now: NOW, scope: 'switchboard' }).active)).toEqual(['mine']);
    expect(ids(buildSessionList(mixed, { search: '', project: null, now: NOW, scope: 'all' }).active)).toEqual(['mine', 'cli']);
    expect(inScope(row('cli'), 'switchboard')).toBe(false);
  });

  it('filters by project and by search', () => {
    expect(ids(buildSessionList(rows, { search: '', project: '/p/b', now: NOW }).active)).toEqual(['newest']);
    const found = buildSessionList(rows, { search: 'LOGIN', project: null, now: NOW });
    expect([...ids(found.active), ...ids(found.archived)]).toEqual(['old']);
  });
});

describe('groupSessions', () => {
  // Relative to local midnight, so the tests hold in any time zone.
  const midnight = startOfDay(NOW);
  const rows = [
    row('pinned-yesterday', { updatedAt: midnight - HOUR, pinned: true }),
    row('today', { updatedAt: midnight + HOUR }),
    row('waiting', { updatedAt: midnight - 3 * 24 * HOUR, live: live('needs-you') }),
    row('busy', { updatedAt: NOW, live: live('running') }),
    row('yesterday', { updatedAt: midnight - 2 * HOUR }),
    row('earlier', { updatedAt: midnight - 30 * HOUR }),
    row('failed-today', { updatedAt: NOW - 60_000, error: true }),
  ];

  it('puts needs-you and working first, then the rest by the day of their last activity', () => {
    expect(sessionGroup(rows[2]!, NOW)).toBe('needs-you');
    expect(sessionGroup(rows[3]!, NOW)).toBe('working');
    expect(sessionGroup(rows[1]!, NOW)).toBe('today');
    expect(sessionGroup(row('x', { updatedAt: midnight }), NOW)).toBe('today');
    expect(sessionGroup(row('x', { updatedAt: midnight - 1 }), NOW)).toBe('yesterday');
    expect(sessionGroup(rows[5]!, NOW)).toBe('earlier');
    // A failed run is news, but not a section of its own: its badge shows it.
    expect(sessionGroup(rows[6]!, NOW)).toBe('today');
    // Idle with a background task isn't "Working": nothing for you to watch in the conversation.
    expect(sessionGroup(row('x', { live: { ...live('idle'), background: ['npm test'] } }), NOW)).toBe('today');
  });

  it('puts pinned sessions in Pinned, unless they wait on you or are working', () => {
    expect(sessionGroup(rows[0]!, NOW)).toBe('pinned');
    expect(sessionGroup(row('x', { pinned: true, live: live('needs-you') }), NOW)).toBe('needs-you');
    expect(sessionGroup(row('x', { pinned: true, live: live('running') }), NOW)).toBe('working');
    expect(sessionGroup(row('x', { pinned: true, unread: true }), NOW)).toBe('pinned');
  });

  it('keeps the given order inside a section and skips empty sections', () => {
    const groups = groupSessions(rows, NOW);
    expect(groups.map((g) => [g.group, ids(g.rows)])).toEqual([
      ['needs-you', ['waiting']],
      ['working', ['busy']],
      ['pinned', ['pinned-yesterday']],
      ['today', ['today', 'failed-today']],
      ['yesterday', ['yesterday']],
      ['earlier', ['earlier']],
    ]);
    expect(groupSessions([rows[1]!], NOW).map((g) => g.group)).toEqual(['today']);
    expect(groupSessions([], NOW)).toEqual([]);
  });

  it('orders Working by when you set each session going, not by its last write', () => {
    const working = (id: string, since: number, updatedAt: number, pinned = false) => row(id, { updatedAt, pinned, live: { ...live('running'), updatedAt: since } });
    // 'first' was started before 'second' but wrote more recently: it stays below.
    const rows = [working('first', NOW - 10 * 60_000, NOW), working('second', NOW - 5 * 60_000, NOW - 60_000), working('pin', NOW - HOUR, NOW - HOUR, true)];
    const list = buildSessionList(rows, { search: '', project: null, now: NOW });
    expect(groupSessions(list.active, NOW).map((g) => ids(g.rows))).toEqual([['pin', 'second', 'first']]);
  });

  it('lists pinned sessions above the days, newest first', () => {
    const list = buildSessionList(
      [row('new', { updatedAt: NOW - 60_000 }), row('pin', { updatedAt: midnight + 1, pinned: true }), row('old-pin', { updatedAt: old, pinned: true })],
      { search: '', project: null, now: NOW },
    );
    expect(groupSessions(list.active, NOW).map((g) => [g.group, ids(g.rows)])).toEqual([
      ['pinned', ['pin', 'old-pin']],
      ['today', ['new']],
    ]);
  });

  it('keeps pinned sessions at the top of Needs you', () => {
    const list = buildSessionList([row('ask', { updatedAt: NOW, live: live('needs-you') }), row('pin', { updatedAt: old, pinned: true, live: live('needs-you') })], { search: '', project: null, now: NOW });
    expect(groupSessions(list.active, NOW).map((g) => ids(g.rows))).toEqual([['pin', 'ask']]);
  });
});

describe('buildListRows', () => {
  const midnight = startOfDay(NOW);
  const active = [row('busy', { live: live('running') }), row('a', { updatedAt: midnight + HOUR }), row('b', { updatedAt: midnight + 2 * HOUR })];
  const archived = [row('old', { updatedAt: old })];
  const shape = (rows: ReturnType<typeof buildListRows>) =>
    rows.map((r) =>
      r.kind === 'session'
        ? r.data.id
        : r.kind === 'group'
          ? `[${r.group} ${r.count}${r.first ? ' first' : ''}]`
          : r.kind === 'later'
            ? `later:${r.item.prompt}`
            : `[${r.kind === 'later-header' ? 'later' : 'archived'} ${r.count} ${r.open ? 'open' : 'closed'}${r.kind === 'later-header' && r.first ? ' first' : ''}]`,
    );
  const saved = (prompt: string, cwd = '/p/a'): LaterItem => ({
    id: prompt,
    cwd,
    prompt,
    model: null,
    effort: null,
    permissionMode: 'default',
    workspace: 'current',
    baseRef: 'fresh',
    branch: null,
    profileId: null,
    createdAt: NOW,
  });

  it('puts a header above each section and the Archived toggle last', () => {
    expect(shape(buildListRows(active, archived, { now: NOW, archivedOpen: false }))).toEqual(['[working 1 first]', 'busy', '[today 2]', 'a', 'b', '[archived 1 closed]']);
    const open = buildListRows(active, archived, { now: NOW, archivedOpen: true });
    expect(shape(open)).toEqual(['[working 1 first]', 'busy', '[today 2]', 'a', 'b', '[archived 1 open]', 'old']);
    expect(open.at(-1)).toMatchObject({ kind: 'session', archived: true });
  });

  it('shows no Archived toggle without archived sessions, and no headers for an empty list', () => {
    expect(shape(buildListRows([], [], { now: NOW, archivedOpen: true }))).toEqual([]);
    expect(shape(buildListRows([], archived, { now: NOW, archivedOpen: true }))).toEqual(['[archived 1 open]', 'old']);
  });

  it('puts prompts saved for later between the sections and Archived, collapsible', () => {
    const later = { items: [saved('Monthly export'), saved('Speaker notes')], open: true };
    expect(shape(buildListRows(active, archived, { now: NOW, archivedOpen: false, later }))).toEqual([
      '[working 1 first]',
      'busy',
      '[today 2]',
      'a',
      'b',
      '[later 2 open]',
      'later:Monthly export',
      'later:Speaker notes',
      '[archived 1 closed]',
    ]);
    expect(shape(buildListRows([], [], { now: NOW, archivedOpen: false, later: { ...later, open: false } }))).toEqual(['[later 2 closed first]']);
    expect(shape(buildListRows(active, [], { now: NOW, archivedOpen: false, later: { items: [], open: true } }))).toEqual(['[working 1 first]', 'busy', '[today 2]', 'a', 'b']);
  });

  it('never offers saved prompts to Select all', () => {
    const rows = buildListRows(active, archived, { now: NOW, archivedOpen: true, later: { items: [saved('Idea')], open: true } });
    expect([...sessionsByHeader(rows)]).toEqual([['working', ['busy']], ['today', ['a', 'b']], ['archived', ['old']]]);
  });

  it('filters saved prompts by project and search', () => {
    const items = [saved('Monthly export', '/p/web'), saved('Speaker notes', '/p/demo')];
    expect(laterInList(items, { search: '', project: null })).toHaveLength(2);
    expect(laterInList(items, { search: '', project: '/p/demo' }).map((i) => i.prompt)).toEqual(['Speaker notes']);
    expect(laterInList(items, { search: 'EXPORT', project: null }).map((i) => i.prompt)).toEqual(['Monthly export']);
    expect(laterInList(items, { search: 'web', project: null }).map((i) => i.prompt)).toEqual(['Monthly export']);
  });

  it('lists the sessions under each header, for Select all', () => {
    const open = sessionsByHeader(buildListRows(active, archived, { now: NOW, archivedOpen: true }));
    expect([...open]).toEqual([['working', ['busy']], ['today', ['a', 'b']], ['archived', ['old']]]);
    expect(sessionsByHeader(buildListRows(active, archived, { now: NOW, archivedOpen: false })).get('archived')).toEqual([]);
  });
});

describe('waitingLabel', () => {
  it('says what a waiting session asks for', () => {
    expect(waitingLabel('Bash')).toBe('Permission: Bash');
    expect(waitingLabel('AskUserQuestion')).toBe('Question');
    expect(waitingLabel('ExitPlanMode')).toBe('Plan to review');
    expect(waitingLabel(null)).toBe('Waiting for you');
  });
});

describe('toRows', () => {
  it('merges live state and adds rows for live sessions without a transcript yet', () => {
    const l = { ...live('running'), sessionId: 'new', cwd: '/p/a/sub', startedAt: 7 };
    expect(toRows(new Map(), new Map([['new', l]]))).toMatchObject([{ id: 'new', title: 'New session', projectRoot: '/p/a', updatedAt: 7, live: l, inApp: false }]);
  });

  it('does not let an idle process move a session up', () => {
    const summary = { id: 's', title: 's', firstPrompt: null, customTitle: null, cwd: '/p/a', projectRoot: '/p/a', gitBranch: null, worktree: null, origin: 'cli', createdAt: null, updatedAt: 1_000, fileSize: null, tag: null, pinned: false, archivedAt: null, viewedAt: null, unread: false, inApp: false, profileId: 'default' } as const;
    const sessions = new Map([['s', summary]]);
    expect(toRows(sessions, new Map([['s', { ...live('idle'), sessionId: 's', updatedAt: 9_000 }]]))[0]!.updatedAt).toBe(1_000);
    expect(toRows(sessions, new Map([['s', { ...live('running'), sessionId: 's', updatedAt: 9_000 }]]))[0]!.updatedAt).toBe(9_000);
  });

  it('prefers the state of sessions running in this app and flags failed runs', () => {
    const host: SessionHostInfo = { sessionId: 'mine', cwd: '/p/a/.claude/worktrees/wt', state: 'needs-you', model: null, permissionMode: 'default', effort: null, costUsd: 0, contextPercent: null, contextTokens: null, contextMax: null, error: null, startedAt: 5, promptedAt: null, queued: 0, profileId: 'default', backgroundTasks: [] };
    const closed: SessionHostInfo = { ...host, sessionId: 'old', state: 'closed' };
    const rows = toRows(new Map(), new Map(), new Map([['mine', host], ['old', closed]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'mine', projectRoot: '/p/a', live: { status: 'needs-you', origin: 'app' }, inApp: true });
  });

  it('puts a session started in this app above one already working', () => {
    const summary = { id: 'busy', title: 'busy', firstPrompt: null, customTitle: null, cwd: '/p/a', projectRoot: '/p/a', gitBranch: null, worktree: null, origin: 'cli', createdAt: null, updatedAt: NOW - HOUR, fileSize: null, tag: null, pinned: false, archivedAt: null, viewedAt: null, unread: false, inApp: true, profileId: 'default' } as const;
    const busy: SessionHostInfo = { sessionId: 'busy', cwd: '/p/a', state: 'running', model: null, permissionMode: 'default', effort: null, costUsd: 0, contextPercent: null, contextTokens: null, contextMax: null, error: null, startedAt: NOW - 2 * HOUR, promptedAt: null, queued: 0, profileId: 'default', backgroundTasks: [] };
    const fresh: SessionHostInfo = { ...busy, sessionId: 'fresh', state: 'starting', startedAt: NOW };
    const rows = toRows(new Map([['busy', summary]]), new Map(), new Map([['busy', busy], ['fresh', fresh]]));
    expect(ids(buildSessionList(rows, { search: '', project: null, now: NOW }).active)).toEqual(['fresh', 'busy']);
  });

  it('dates a session from this app by the last message you sent it', () => {
    const host: SessionHostInfo = { sessionId: 'mine', cwd: '/p/a', state: 'running', model: null, permissionMode: 'default', effort: null, costUsd: 0, contextPercent: null, contextTokens: null, contextMax: null, error: null, startedAt: 5, promptedAt: 50, queued: 0, profileId: 'default', backgroundTasks: [] };
    expect(toRows(new Map(), new Map(), new Map([['mine', host]]))[0]!.live).toMatchObject({ startedAt: 5, updatedAt: 50 });
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

describe('startupSession', () => {
  const rows = [row('mine', { inApp: true }), row('terminal')];

  it('reopens the last session the sidebar lists', () => {
    expect(startupSession(rows, 'mine', 'last', 'switchboard')).toBe('mine');
    expect(startupSession(rows, 'terminal', 'last', 'all')).toBe('terminal');
  });

  it('opens New session for a hidden, missing or unknown session, or when asked to', () => {
    expect(startupSession(rows, 'terminal', 'last', 'switchboard')).toBeNull();
    expect(startupSession(rows, 'gone', 'last', 'all')).toBeNull();
    expect(startupSession(rows, null, 'last', 'all')).toBeNull();
    expect(startupSession(rows, 'mine', 'new', 'all')).toBeNull();
    expect(startupSession(rows, 'mine', 'home', 'all')).toBeNull();
  });
});
