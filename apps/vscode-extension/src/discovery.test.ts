import { describe, expect, it } from 'vitest';
import { COMPANION_PROTOCOL } from '@switchboard/protocol/companion-client';
import { infoFiles, pickInfo } from './discovery.ts';

const info = (pid: number, protocol = COMPANION_PROTOCOL) => JSON.stringify({ protocol, socket: `/tmp/sb-${pid}/engine.sock`, token: 'abc', pid, startedAt: 1, appVersion: '1.2.3' });

describe('discovery', () => {
  it('looks for the installed app first, then a development build, or where the settings say', () => {
    expect(infoFiles('/Users/me', '')).toEqual([
      '/Users/me/Library/Application Support/Switchboard/companion/engine.json',
      '/Users/me/Library/Application Support/Switchboard Dev/companion/engine.json',
    ]);
    expect(infoFiles('/Users/me', '~/sb-data/')).toEqual(['/Users/me/sb-data/companion/engine.json']);
  });

  it('skips files left behind by an engine that is gone, and unreadable ones', () => {
    const found = pickInfo(
      [
        { file: 'a', text: info(1) },
        { file: 'b', text: 'garbage' },
        { file: 'c', text: null },
        { file: 'd', text: info(2) },
      ],
      (pid) => pid === 2,
    );
    expect(found).toMatchObject({ kind: 'found', file: 'd', info: { pid: 2, socket: '/tmp/sb-2/engine.sock', appVersion: '1.2.3' } });
    expect(pickInfo([{ file: 'a', text: info(1) }], () => false)).toEqual({ kind: 'none' });
  });

  it('says when the running Switchboard speaks another version of the protocol', () => {
    expect(pickInfo([{ file: 'a', text: info(1, COMPANION_PROTOCOL + 1) }], () => true)).toMatchObject({ kind: 'incompatible', info: { protocol: COMPANION_PROTOCOL + 1 } });
  });
});
