import { describe, expect, it } from 'vitest';
import type { TranscriptMessage } from '@switchboard/protocol/client';
import { buildDisplayItems } from './displayItems.ts';
import { toolSummary } from './toolSummary.ts';

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
    expect(items).toEqual([
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
