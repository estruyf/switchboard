import { describe, expect, it } from 'vitest';
import type { TranscriptMessage } from '@switchboard/protocol/client';
import { buildDisplayItems, groupActivity, type DisplayItem } from './displayItems.ts';
import { activitySummary, gerund, stepLabel, toolSummary } from './toolSummary.ts';

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
    expect(['Read', 'Run', 'Use', 'Write', 'Fix', 'Stop', 'Open', 'Tie', 'Check', 'commit'].map(gerund)).toEqual([
      'Reading', 'Running', 'Using', 'Writing', 'Fixing', 'Stopping', 'Opening', 'Tying', 'Checking', 'committing',
    ]);
  });
});
