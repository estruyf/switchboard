import { describe, expect, it } from 'vitest';
import { backgroundKind, backgroundSummary } from './backgroundTasks.ts';

describe('background tasks', () => {
  it('names the kinds Claude Code reports, and falls back for new ones', () => {
    expect(backgroundKind('local_bash')).toBe('shell');
    expect(backgroundKind('local_agent')).toBe('agent');
    expect(backgroundKind('local_workflow')).toBe('workflow');
    expect(backgroundKind('something_new')).toBe('other');
  });

  it('says what runs when every task is the same kind', () => {
    expect(backgroundSummary(['local_bash'])).toBe('1 background command');
    expect(backgroundSummary(['local_agent', 'remote_agent'])).toBe('2 background agents');
    expect(backgroundSummary(['local_bash', 'local_agent'])).toBe('2 background tasks');
    expect(backgroundSummary(['local_workflow'])).toBe('1 background task');
  });
});
