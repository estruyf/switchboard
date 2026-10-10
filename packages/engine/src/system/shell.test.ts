import { execFileSync, spawnSync } from 'node:child_process';
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

describe('sequence', () => {
  it('chains with && where the shell has it, and with $? in Windows PowerShell 5.1', () => {
    expect(userShell({ SHELL: '/bin/zsh' }, 'darwin').sequence(['git push', 'gh pr create'])).toBe('git push && gh pr create');
    expect(userShell({ PATH: 'C:\\pwsh' }, 'win32', (p) => p === 'C:\\pwsh\\pwsh.exe').sequence(['a', 'b'])).toBe('a && b');
    expect(userShell({ PATH: '' }, 'win32', () => false).sequence(['a', 'b', 'c'])).toBe('a; if ($?) { b }; if ($?) { c }');
  });

  it.skipIf(process.platform !== 'win32')('runs the next command in Windows PowerShell 5.1 only when the last one succeeded', () => {
    const shell = userShell({ PATH: '', SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' }, 'win32', () => false);
    const run = (commands: string[]) => {
      const result = spawnSync(shell.file, ['-NoProfile', ...shell.run(shell.sequence(commands)).slice(1)], { encoding: 'utf8' });
      return { out: result.stdout.trim(), failed: result.status !== 0 };
    };
    expect(run(['cmd /c exit 0', 'Write-Output ran'])).toEqual({ out: 'ran', failed: false });
    // The next command is skipped, and the line ends as failed, so the action's tab says so.
    expect(run(['cmd /c exit 1', 'Write-Output ran'])).toEqual({ out: '', failed: true });
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
