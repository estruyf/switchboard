import { describe, expect, it } from 'vitest';
import type { TranscriptMessage } from '@switchboard/protocol/client';
import { agentReport, buildDisplayItems, groupActivity, type DisplayItem } from './displayItems.ts';
import { activitySummary, gerund, stepLabel, toolSummary } from './toolSummary.ts';
import { agentRuns } from './agentRuns.ts';

const m = (uuid: string, role: TranscriptMessage['role'], blocks: TranscriptMessage['blocks'], parentToolUseId: string | null = null): TranscriptMessage => ({
  uuid,
  role,
  timestamp: null,
  parentToolUseId,
  model: null,
  blocks,
});

describe('buildDisplayItems', () => {
  it('pairs tool calls with their results and hides result-only user turns', () => {
    const items = buildDisplayItems([
      m('u1', 'user', [{ type: 'text', text: 'Run the tests' }]),
      m('a1', 'assistant', [
        { type: 'thinking', text: 'ok' },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' }, truncated: false },
      ]),
      m('u2', 'user', [{ type: 'tool_result', toolUseId: 't1', isError: false, text: '5 passed', truncated: false, images: [] }]),
      m('a2', 'assistant', [{ type: 'text', text: 'All green.' }]),
    ]);
    expect(items.map((i) => i.kind)).toEqual(['user', 'thinking', 'tool', 'text']);
    expect(items[2]).toMatchObject({ kind: 'tool', name: 'Bash', result: { text: '5 passed', isError: false } });
  });

  it('recognises slash commands, command output, interrupts and strips system reminders', () => {
    const items = buildDisplayItems([
      m('u1', 'user', [{ type: 'text', text: '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>--fast</command-args>' }]),
      m('u2', 'user', [{ type: 'text', text: '<local-command-stdout>Compacted</local-command-stdout>' }]),
      m('u3', 'user', [{ type: 'text', text: '[Request interrupted by user for tool use]' }]),
      m('u4', 'user', [{ type: 'text', text: '<system-reminder>hidden</system-reminder>' }]),
      m('u5', 'user', [{ type: 'text', text: 'Real prompt<system-reminder>x</system-reminder>' }]),
    ]);
    expect(items).toMatchObject([
      { kind: 'command', key: 'u1', name: '/review', args: '--fast' },
      { kind: 'notice', key: 'u2', text: 'Compacted' },
      { kind: 'notice', key: 'u3', text: 'Interrupted by you' },
      { kind: 'user', key: 'u5', text: 'Real prompt', images: [], subagent: false },
    ]);
  });

  it('marks subagent output and labels system events', () => {
    const items = buildDisplayItems([
      m('a1', 'assistant', [{ type: 'text', text: 'from a subagent' }], 'task-1'),
      m('s1', 'system', [{ type: 'unknown', kind: 'compact_boundary' }]),
    ]);
    expect(items).toMatchObject([{ kind: 'text', subagent: true }, { kind: 'notice', text: 'Conversation compacted' }]);
  });
});

describe('toolSummary', () => {
  it('summarises common tools', () => {
    expect(toolSummary('Read', { file_path: '/repo/src/a.ts' }, '/repo')).toEqual({ label: 'Read', detail: 'src/a.ts' });
    expect(toolSummary('Bash', { command: 'npm test', description: 'Run tests' }, null)).toEqual({ label: 'Bash', detail: 'Run tests' });
    expect(toolSummary('TodoWrite', { todos: [{ status: 'completed' }, { status: 'pending' }] }, null)).toEqual({ label: 'Todos', detail: '1/2 done' });
    expect(toolSummary('mcp__claude_ai_Notion__notion-search', { query: 'roadmap' }, null)).toEqual({ label: 'Notion · notion-search', detail: 'roadmap' });
  });
});

const tool = (key: string, name: string, input: Record<string, unknown> = {}): DisplayItem => ({
  kind: 'tool', key, at: null, id: key, name, input, inputTruncated: false, result: null, subagent: false,
});
const text = (key: string, value: string): DisplayItem => ({ kind: 'text', key, at: null, text: value, subagent: false });

describe('groupActivity', () => {
  it('collapses runs of tool calls between messages and keeps plans visible', () => {
    const grouped = groupActivity([
      text('t1', 'Let me look.'),
      tool('a', 'Read', { file_path: '/r/a.ts' }),
      { kind: 'thinking', key: 'th', at: null, text: 'hmm' },
      tool('b', 'Bash', { command: 'ls' }),
      text('t2', 'Found it.'),
      tool('c', 'ExitPlanMode', { plan: 'Do it' }),
      tool('d', 'Edit', { file_path: '/r/a.ts' }),
    ]);
    expect(grouped.map((g) => (g.kind === 'activity' ? `group(${g.items.map((i) => i.key).join(',')})` : g.key))).toEqual(['t1', 'group(a,th,b)', 't2', 'c', 'group(d)']);
    expect(grouped[1]!.key).toBe('activity:a');
  });
});

describe('activitySummary', () => {
  it('counts what a run did, files once each', () => {
    expect(
      activitySummary([
        tool('1', 'Bash'),
        tool('2', 'Bash'),
        tool('3', 'Edit', { file_path: '/a' }),
        tool('4', 'Edit', { file_path: '/a' }),
        tool('5', 'Read', { file_path: '/b' }),
      ]),
    ).toBe('Ran 2 commands, edited a file and read a file');
    expect(activitySummary([tool('1', 'mcp__claude_ai_Notion__notion-search')])).toBe('Used Notion');
    expect(activitySummary([{ kind: 'thinking' }])).toBe('Thought it through');
  });
});

describe('stepLabel', () => {
  it('words steps like Claude Code, in the past for the list and the present while running', () => {
    expect(stepLabel(tool('1', 'Bash', { command: 'npm test', description: 'Run the unit tests' }), null)).toEqual({ past: 'Run the unit tests', present: 'Running the unit tests' });
    expect(stepLabel(tool('1', 'Read', { file_path: '/repo/src/a.ts' }), '/repo')).toEqual({ past: 'Read src/a.ts', present: 'Reading src/a.ts' });
    expect(stepLabel(tool('1', 'Grep', { pattern: 'TODO' }), null).present).toBe('Searching for TODO');
    // Not every description starts with a verb.
    expect(stepLabel(tool('1', 'Bash', { description: 'Only stop when scrolling up' }), null).present).toBe('Only stop when scrolling up');
    expect(stepLabel(tool('1', 'Bash', { description: 'Rerun the smoke test' }), null).present).toBe('Rerunning the smoke test');
    expect(stepLabel(tool('1', 'Bash', { description: 'Read the file' }), null).present).toBe('Reading the file');
  });

  it('turns verbs into -ing forms', () => {
    expect(['Read', 'Run', 'Use', 'Write', 'Fix', 'Stop', 'Open', 'Tie', 'Check', 'commit', 'Let', 'Add', 'Show', 'Plan', 'Edit', 'Visit', 'Quit', 'Rerun'].map(gerund)).toEqual([
      'Reading', 'Running', 'Using', 'Writing', 'Fixing', 'Stopping', 'Opening', 'Tying', 'Checking', 'committing', 'Letting', 'Adding', 'Showing', 'Planning', 'Editing', 'Visiting', 'Quitting', 'Rerunning',
    ]);
  });
});

describe('agent reports', () => {
  const handBack =
    'Another Claude session sent a message:\n<agent-message from="ac19e09f62c5886f3">\n[Subagent hand-back] The text below is the final report. The report follows:\n  Found **3 files**.\n  \n  - a.txt\n</agent-message>\n\nGuidance for the session.';

  it('reads the agent id and the report, without the indent', () => {
    expect(agentReport(handBack)).toEqual({ agentId: 'ac19e09f62c5886f3', toolUseId: null, status: 'completed', title: 'Found **3 files**.', text: 'Found **3 files**.\n\n- a.txt' });
    const notification =
      '<task-notification>\n<task-id>aa50</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>completed</status>\n<summary>Agent "List files" finished</summary>\n<result>79 files</result>\n</task-notification>';
    expect(agentReport(notification)).toEqual({ agentId: 'aa50', toolUseId: 'toolu_1', status: 'completed', title: 'Agent "List files" finished', text: '79 files' });
  });

  it('turns a hand-back into a report item that groups with the other steps', () => {
    const items = buildDisplayItems([m('u1', 'user', [{ type: 'text', text: handBack }])]);
    expect(items).toMatchObject([{ kind: 'agent-report', agentId: 'ac19e09f62c5886f3' }]);
    expect(groupActivity(items)[0]!.kind).toBe('activity');
    expect(activitySummary(items)).toBe('An agent reported back');
  });
});

describe('agentRuns', () => {
  const agent = (key: string, result: string | null): DisplayItem => ({
    ...tool(key, 'Agent', { description: key }),
    result: result === null ? null : { text: result, isError: false, truncated: false, images: [], at: null },
  } as DisplayItem);
  const launched = (id: string) => `Async agent launched successfully.\nagentId: ${id} (internal ID)\nThe agent is working in the background.`;

  it('runs foreground agents until they return and background ones until they report back', () => {
    const items = [
      agent('fg-done', 'Found 3 files'),
      agent('fg-running', null),
      agent('bg-running', launched('abc123')),
      agent('bg-done', launched('def456')),
      { kind: 'agent-report', key: 'r', at: null, agentId: 'def456', toolUseId: null, status: 'completed', title: 'Done', text: 'Done' } as DisplayItem,
    ];
    expect(agentRuns(items, true).map((r) => [r.item.key, r.running, r.background])).toEqual([
      ['fg-done', false, false],
      ['fg-running', true, false],
      ['bg-running', true, true],
      ['bg-done', false, true],
    ]);
    // Nothing runs in a session that isn't open.
    expect(agentRuns(items, false).some((r) => r.running)).toBe(false);
  });
});
