import { describe, expect, it } from 'vitest';
import { ConfigDirLane } from './configDirLane.ts';

describe('ConfigDirLane', () => {
  it('runs calls for one folder together and switches folders only between them', async () => {
    const env: Record<string, string | undefined> = {};
    const lane = new ConfigDirLane(env);
    const log: string[] = [];
    const call = (dir: string | undefined, name: string, ms: number) =>
      lane.run(dir, async () => {
        log.push(`start ${name} ${env.CLAUDE_CONFIG_DIR ?? '-'}`);
        await new Promise((resolve) => setTimeout(resolve, ms));
        // The folder never changes under a running call.
        log.push(`end ${name} ${env.CLAUDE_CONFIG_DIR ?? '-'}`);
        return name;
      });

    const results = await Promise.all([call('/a', 'a1', 30), call('/a', 'a2', 10), call('/b', 'b1', 10), call('/a', 'a3', 10), call(undefined, 'own', 5)]);
    expect(results).toEqual(['a1', 'a2', 'b1', 'a3', 'own']);
    expect(log).toEqual([
      'start a1 /a',
      'start a2 /a',
      'end a2 /a',
      'end a1 /a',
      // a3 waited behind b1 rather than jumping the queue.
      'start b1 /b',
      'end b1 /b',
      'start a3 /a',
      'end a3 /a',
      'start own -',
      'end own -',
    ]);
    expect('CLAUDE_CONFIG_DIR' in env).toBe(false);
  });

  it('lets the next folder run after a call fails', async () => {
    const env: Record<string, string | undefined> = {};
    const lane = new ConfigDirLane(env);
    const failing = lane.run('/a', async () => {
      throw new Error('boom');
    });
    const next = lane.run('/b', async () => env.CLAUDE_CONFIG_DIR);
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('/b');
  });
});
