import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { posixQuote, powershellQuote, userShell } from './shell.ts';

const decode = (args: string[]) => Buffer.from(args[2]!, 'base64').toString('utf16le');

describe('userShell', () => {
  it('is $SHELL as a login shell on macOS and Linux', () => {
    const shell = userShell({ SHELL: '/bin/bash' }, 'darwin');
    expect(shell).toMatchObject({ file: '/bin/bash', kind: 'posix', interactive: ['-l'] });
    expect(shell.run('npm test')).toEqual(['-ilc', 'npm test']);
    expect(userShell({}, 'linux').file).toBe('/bin/zsh');
  });

  it('is PowerShell 7 on Windows when it is on PATH, else Windows PowerShell', () => {
    const env = { PATH: 'C:\\Windows\\System32;C:\\Program Files\\PowerShell\\7', SystemRoot: 'C:\\Windows' };
    const pwsh = userShell(env, 'win32', (p) => p === 'C:\\Program Files\\PowerShell\\7\\pwsh.exe');
    expect(pwsh).toMatchObject({ file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', kind: 'powershell', interactive: ['-NoLogo'] });
    expect(userShell(env, 'win32', () => false).file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });

  it('hands PowerShell the command encoded, so nothing in between can change it', () => {
    const args = userShell({ PATH: '' }, 'win32', () => false).run('echo "a b" && git log -1');
    expect(args.slice(0, 2)).toEqual(['-NoLogo', '-EncodedCommand']);
    expect(decode(args)).toBe('echo "a b" && git log -1');
  });
});

describe('quoting', () => {
  const nasty = ["it's", "feat/x'; rm -rf ~ #",'a "b" $(rm -rf ~) `x` $HOME', 'semi; colon & and | pipe', 'smart ’quote‘ here', ''];

  it('quotes for POSIX shells and PowerShell', () => {
    expect(posixQuote("it's")).toBe(`'it'\\''s'`);
    expect(powershellQuote("it's")).toBe(`'it''s'`);
    expect(powershellQuote('a’b')).toBe(`'a’’b'`);
  });

  it.skipIf(process.platform === 'win32')('passes every value to /bin/sh as it is', () => {
    for (const value of nasty) expect(execFileSync('/bin/sh', ['-c', `printf %s ${posixQuote(value)}`]).toString()).toBe(value);
  });

  it.skipIf(process.platform !== 'win32')('passes every value to PowerShell as it is', () => {
    const shell = userShell(process.env as Record<string, string>);
    for (const value of nasty) {
      // UTF-8 out, or the console code page turns ’ into ' on the way back.
      const command = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Out.Write(${powershellQuote(value)})`;
      const out = execFileSync(shell.file, ['-NoProfile', ...shell.run(command).slice(1)], { encoding: 'utf8' });
      expect(out).toBe(value);
    }
  });
});
