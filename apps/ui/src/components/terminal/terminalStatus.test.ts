import { describe, expect, it } from 'vitest';
import { actionCommand, elapsedLabel, runStatus, tabStatus, trackRuns, type RunTimes } from './terminalStatus.ts';

describe('runStatus', () => {
  it('says Running while there is no exit code', () => {
    expect(runStatus(null)).toEqual({ state: 'running', label: 'Running' });
  });
  it('says Exited 0 for a clean exit', () => {
    expect(runStatus(0)).toEqual({ state: 'done', label: 'Exited 0' });
  });
  it('says Failed with the code otherwise (130 after Stop)', () => {
    expect(runStatus(1)).toEqual({ state: 'failed', label: 'Failed (exit 1)' });
    expect(runStatus(130).label).toBe('Failed (exit 130)');
  });
});

describe('tabStatus', () => {
  it('shows a working dot only on a running action', () => {
    expect(tabStatus({ kind: 'action', exitCode: null })).toEqual({ dot: 'running', note: null });
    expect(tabStatus({ kind: 'shell', exitCode: null })).toEqual({ dot: null, note: null });
    expect(tabStatus({ kind: 'claude', exitCode: null })).toEqual({ dot: null, note: null });
  });
  it('shows an error dot and the code for any tab that failed', () => {
    expect(tabStatus({ kind: 'action', exitCode: 2 })).toEqual({ dot: 'failed', note: 'exit 2' });
    expect(tabStatus({ kind: 'shell', exitCode: 1 })).toEqual({ dot: 'failed', note: 'exit 1' });
  });
  it('notes a clean exit without a dot', () => {
    expect(tabStatus({ kind: 'shell', exitCode: 0 })).toEqual({ dot: null, note: 'exit 0' });
  });
});

describe('elapsedLabel', () => {
  it('shows minutes and seconds', () => {
    expect(elapsedLabel(0)).toBe('0:00');
    expect(elapsedLabel(7_400)).toBe('0:07');
    expect(elapsedLabel(754_000)).toBe('12:34');
  });
  it('adds hours after an hour', () => {
    expect(elapsedLabel(3_723_000)).toBe('1:02:03');
  });
  it('never goes negative (a clock that moved back) or breaks on a bad value', () => {
    expect(elapsedLabel(-5_000)).toBe('0:00');
    expect(elapsedLabel(Number.NaN)).toBe('0:00');
  });
});

describe('actionCommand', () => {
  const actions = [
    { name: 'Dev server', command: 'npm run dev', type: 'shell' },
    { name: 'Review', command: 'Review the diff', type: 'prompt' },
    { name: 'Install', command: 'npm install', type: 'shell' },
  ];
  it('finds the command of the action the tab runs', () => {
    expect(actionCommand('Dev server', actions)).toBe('npm run dev');
  });
  it('finds a setup action by its name', () => {
    expect(actionCommand('Setup: Install', actions)).toBe('npm install');
  });
  it('falls back to the title for tabs without a shell action', () => {
    expect(actionCommand('Commit', actions)).toBe('Commit');
    expect(actionCommand('Review', actions)).toBe('Review');
  });
});

describe('trackRuns', () => {
  const t = (id: string, exitCode: number | null, startedAt = 1_000) => ({ id, kind: 'action' as const, title: id, exitCode, startedAt });
  const before = (...list: ReturnType<typeof t>[]) => new Map(list.map((x) => [x.id, x]));

  it('starts a new terminal at its startedAt', () => {
    expect(trackRuns(new Map(), new Map(), [t('a', null)], 5_000).get('a')).toEqual({ startedAt: 1_000, endedAt: null });
  });
  it('ends a run when its exit is seen', () => {
    const runs = new Map<string, RunTimes>([['a', { startedAt: 1_000, endedAt: null }]]);
    expect(trackRuns(runs, before(t('a', null)), [t('a', 130)], 9_000).get('a')).toEqual({ startedAt: 1_000, endedAt: 9_000 });
  });
  it('starts a new run on Restart', () => {
    const runs = new Map<string, RunTimes>([['a', { startedAt: 1_000, endedAt: 9_000 }]]);
    expect(trackRuns(runs, before(t('a', 130)), [t('a', null)], 12_000).get('a')).toEqual({ startedAt: 12_000, endedAt: null });
  });
  it('keeps a run that did not change and drops closed terminals', () => {
    const runs = new Map<string, RunTimes>([
      ['a', { startedAt: 1_000, endedAt: null }],
      ['b', { startedAt: 2_000, endedAt: null }],
    ]);
    const next = trackRuns(runs, before(t('a', null), t('b', null)), [t('a', null)], 20_000);
    expect(next.get('a')).toEqual({ startedAt: 1_000, endedAt: null });
    expect(next.has('b')).toBe(false);
  });
  it('does not know when a terminal that had already exited ended', () => {
    expect(trackRuns(new Map(), new Map(), [t('a', 0)], 5_000).get('a')).toEqual({ startedAt: 1_000, endedAt: null });
  });
});
