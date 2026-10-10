import { describe, expect, it } from 'vitest';
import { COMPANION_PROTOCOL } from '@switchboard/protocol/companion-client';
import { infoFiles, pickInfo } from './discovery.ts';

const info = (pid: number, protocol = COMPANION_PROTOCOL) => JSON.stringify({ protocol, socket: `/tmp/sb-${pid}/engine.sock`, token: 'abc', pid, startedAt: 1, appVersion: '1.2.3' });

describe('discovery', () => {
  it('looks for the installed app first, then a development build, or where the settings say', () => {
    expect(infoFiles('/Users/me', '', 'darwin')).toEqual([
      '/Users/me/Library/Application Support/Switchboard/companion/engine.json',
      '/Users/me/Library/Application Support/Switchboard Dev/companion/engine.json',
    ]);
    expect(infoFiles('/Users/me', '~/sb-data/', 'darwin')).toEqual(['/Users/me/sb-data/companion/engine.json']);
  });

  it('looks in %APPDATA% on Windows and ~/.config on Linux, where Electron keeps app data', () => {
    expect(infoFiles('C:\\Users\\me', '', 'win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' })).toEqual([
      'C:\\Users\\me\\AppData\\Roaming\\Switchboard\\companion\\engine.json',
      'C:\\Users\\me\\AppData\\Roaming\\Switchboard Dev\\companion\\engine.json',
    ]);
    expect(infoFiles('C:\\Users\\me', '', 'win32', {})[0]).toBe('C:\\Users\\me\\AppData\\Roaming\\Switchboard\\companion\\engine.json');
    expect(infoFiles('C:\\Users\\me', '~\\sb-data', 'win32', {})).toEqual(['C:\\Users\\me\\sb-data\\companion\\engine.json']);
    expect(infoFiles('/home/me', '', 'linux', {})[0]).toBe('/home/me/.config/Switchboard/companion/engine.json');
  });

  it('takes a named pipe as the socket, and nothing else that is not a path', () => {
    const withSocket = (socket: string) => pickInfo([{ file: 'a', text: JSON.stringify({ protocol: COMPANION_PROTOCOL, socket, token: 'abc', pid: 1 }) }], () => true).kind;
    expect(withSocket('\\\\.\\pipe\\switchboard-0123abcd')).toBe('found');
    expect(withSocket('/tmp/sb/engine.sock')).toBe('found');
    expect(withSocket('engine.sock')).toBe('none');
    expect(withSocket('\\\\server\\share\\engine.sock')).toBe('none');
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
