import { describe, expect, it, vi } from 'vitest';
import { QuitGuard } from './quitGuard.ts';

const setup = () => {
  const ask = vi.fn();
  const quit = vi.fn();
  return { ask, quit, guard: new QuitGuard({ ask, quit }) };
};

describe('QuitGuard', () => {
  it('asks on the first ⌘Q and quits on the second', () => {
    const { ask, quit, guard } = setup();
    guard.request();
    expect(ask).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();
    guard.request();
    expect(quit).toHaveBeenCalledOnce();
  });

  it('quits or stays depending on the answer', () => {
    const { ask, quit, guard } = setup();
    guard.request();
    guard.answer('cancel');
    expect(quit).not.toHaveBeenCalled();
    expect(guard.asking).toBe(false);
    guard.request();
    expect(ask).toHaveBeenCalledTimes(2);
    guard.answer('quit');
    expect(quit).toHaveBeenCalledOnce();
  });

  it('ignores answers when no prompt is open', () => {
    const { quit, guard } = setup();
    guard.answer('quit');
    guard.request();
    guard.request();
    guard.answer('quit');
    expect(quit).toHaveBeenCalledOnce();
  });
});
